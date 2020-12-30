/*
 * ECHONET Lite HVAC MQTT Service
 *
 * This service syncs information between ECHONET Lite HVAC devices and MQTT
 * for integration with home automation systems.
 *
 * Copyright 2018 Jethro Carr
 * See LICENSE file for MIT license conditions.
 *
 */

// Setup the watchdog
var Watchpuppy = require('watchpuppy');

// Time out is set to POLL_FREQUENCY + 60 seconds.
var watchdogTimer = process.env.WATCHDOG_TIMER || 60;
if (process.env.POLL_FREQUENCY) {
  watchdogTimer = parseInt(process.env.POLL_FREQUENCY) + 1
}

// If timeout occurs, terminate.
var watchdog = new Watchpuppy({checkInterval: watchdogTimer * 1000, minPing: 1, stopOnError: true}, (err) => {
  showErrorExit("Terminated due to watchdog timeout (no activity for " + watchdogTimer + " seconds)");
});


// Establish the MQTT connection.
if (!process.env.MQTT_URL) {
    showErrorExit("You must set the MQTT_URL environmental");
} else {
 console.log("Using MQTT endpoint: " + process.env.MQTT_URL);
}

var mqtt = require('mqtt');
var mqttClient = mqtt.connect(process.env.MQTT_URL);

// Handle MQTT stuff
mqttClient.on('connect', function () {
  console.log("Successfully established MQTT connection, starting scan for devices");
  loopDevices();
})

mqttClient.on('reconnect', function () {
  // This will fire repeatedly if the MQTT configuration is wrong and unable to
  // establish a connection. If you're seeing it non-stop, your config is wrong.
  console.log("Reconnecting to MQTT");
})

mqttClient.on('error', function () {
  console.log("An error occured talking with MQTT");
})

mqttClient.on('message', function (topic, message) {
  // message is Buffer
  console.log("Received "+ topic +" = '"+ message +"'");

  // Extract name of device and EPC using the topic.
  var fullTopic        = topic;
  var value            = message.toString();
  var splitTopic       = fullTopic.toString().split("/");
  var shortTopic       = splitTopic[3]
  var deviceName       = splitTopic[2]
  var epc              = epcMapping[shortTopic];
  var deviceAttributes = devices[deviceName];

  // Set the property on the device.
  enlSetProperty(deviceAttributes.address, deviceAttributes.eoj, epc, value);

})


// Establish the ECHONET Lite connection.
var discoveryTime = process.env.DISCOVERY_TIME || 10;
var pollFrequency = process.env.POLL_FREQUENCY || 30;

var EchonetLite = require('node-echonet-lite');
var enlClient  = new EchonetLite({'type': 'lan'});

// Store discovered devices
var devices = {}

// Topics and their corresponding ECHONET Lite codes
var epcMapping = {
  'hvac_command_power': 0x80,
  'hvac_command_mode': 0xB0,
  'hvac_command_target_temperature': 0xB3,
  'hvac_command_fanmode': 0xA0,
  'hvac_state_power': 0x80,
  'hvac_state_mode': 0xB0,
  'hvac_state_target_temperature': 0xB3,
  'hvac_state_room_temperature': 0xBB,
  'hvac_state_fanmode': 0xA0,
};

var mqttTopics = Object.keys(epcMapping); // more convinent form.

/*
 * The ECHONET Lite standard allows for 8 levels but my Mitsubishi
 * only supports three - 2 (low), 3 (medium) and 5 (high). I dunno
 * what kinda logic it has and how this compares to other devices, so
 * I fear in the future we may need device-specific logic here for
 * different vendors.
 */
/*
    0: auto
    1: quiet
    2: low
    3: medium
    4: ??? unknown ???
    5: high
    6: super_high
    7: ??? unknown ???
    8: ???? unknown ????
*/
var epcFanModes = ['auto', 'quiet', 'low', 'medium', 'medium', 'high', 'super high', 'high', 'high'];


/* These mode descriptions are specifically chosen to suit passthrough
 * from Home Assistant to Apple Homekit which only seems to recognise
 * 'auto', 'cool', 'heat' and 'off' (when the whole unit is stopped.)
 *
 * The ECHONET Lite Node library we are using has it's own alternative
 * descriptions which I've chosen not use for the above reason.
 */
var epcOperatingModes = ['other', 'auto', 'cool', 'heat', 'dry', 'fan_only'];


/*
 * Not sure if this implementation is multi-device safe. In theory the discovery
 * is supposed to trigger the callback for every device it finds, but I'm not
 * clear whether or not the stopDiscovery() method means it halts all further
 * discovery of new devices, or just relates specifically to the one it did find.
 *
 * I only have a single ECHONET Lite enabled HVAC unit, so if you have multiples
 * I'd be grateful for a PR that either confirms it works fine and updates this
 * comment *OR* a PR that corrects this code to support multiple units correctly.
 */

function loopDevices() {

  enlClient.init((err) => {

    if (err) {
      showErrorExit(err);
    } else {
      // We run the discovery process for a fixed duration, then process all
      // discovered devices in parallel.
      console.log("Running ECHONET Lite discovery (" + discoveryTime + " seconds)");

      // Number of expected devices
      var numExpectedDevices = process.env.NUM_EXPECTED_DEVICES || 1;
      if (numExpectedDevices <= 0) {
        numExpectedDevices = 1;
      }
      console.log("Expected Devices: " + numExpectedDevices);

      discoverDevices(devices);

      setTimeout(async function() {
        console.log("Discovery completed");

        // Stop further discovery
        //enlClient.stopDiscovery();

        // Check the number of discovered devices is what we expect
        var numFound = Object.keys(devices).length;
        if (numFound < numExpectedDevices) {
          showErrorExit("Number of devices found (" + numFound + ") is less than expected (" + numExpectedDevices + ")");
        }

        // Launch
        console.log("Now processing discovered devices...")
        console.log(JSON.stringify(devices));

        // Setup devices for MQTT subscriptions
        for (var device in devices) {
          // We do this sync rather than async to ensure we don't overload upset
          // the MQTT broker by firing too many at once.
          await subscribeDevice(device, devices[device]);
        }

        // Poll all devices
        while (true) {
          console.log("Polling for device status (every " + pollFrequency + " seconds)")

          for (var device in devices) {
            // In theory this function should be safe for parallel execution given
            // we are touching a different device, but let's keep it sync for
            // easier debugging and log comprehension.
            await pollDevice(device, devices[device]);
          }

          await sleep((pollFrequency * 1000));
        }

      }, (discoveryTime * 1000));
    }
  });
}

// Discover all the ECHONET Lite devices on the network.
function discoverDevices(devices) {

  enlClient.startDiscovery((err, res) => {

    if(err) {
      showErrorExit(err);
    }

    console.log("Found ECHONET Lite device")

    // Determine the type of the found device
    var device = res['device'];
    var address = device['address'];
    var eoj = device['eoj'][0];
    var group_code = eoj[0]; // Class group code
    var class_code = eoj[1]; // Class code

    // We are only interested in HVAC devices
    if (group_code === 0x01 && class_code === 0x30) {

      // This means that the found device belongs to the home air conditioner class
      console.log('Found an air conditioner on: ' + address);
      console.log('EOJ: ' + JSON.stringify(eoj));

      /*
       * We give the device a name based on the IP address. This works for me
       * since I can grant static DHCP leases to my devices so the addresses do
       * not change. Couldn't see a better way, since ECHONET Lite does not seem
       * to return the names or serial of a device, so can't set fixed names. If
       * you have a better solution, PRs welcome.
       */
      var name = address.replace(/\./g, "_");

      devices[name] = {
        address: address,
        eoj: eoj
      };

    } else {
      console.log("Discovered device at " + address + " not an HVAC, ignoring")
    }
  });
}


// Subscribe a device to it's associated MQTT queues for changes.
async function subscribeDevice(deviceName, deviceAttributes) {
  console.log("Setting up MQTT subscriptions for: "+ deviceName)

  var mqttPrefix = '/echonetlite/'+ deviceName +'/';
  var mqttFullTopics = []

  mqttTopics.forEach(function(element) {
    // Only need to subscribe to command topics.
    if (element.startsWith('hvac_command')) {
      var newTopic = mqttPrefix + element
      console.log("Subscribing to: "+ newTopic)
      mqttFullTopics.push(newTopic)
    }
  });

  mqttClient.subscribe(mqttFullTopics, {}, function (err) {
    if (err) {
      showErrorExit('Unable to subscribe to MQTT topics - check MQTT config & access');
    }
  });
}

// Poll devices for current status
async function pollDevice(deviceName, deviceAttributes) {
  console.log("Polling device: "+ deviceName)
  watchdog.ping(); // Safety - if we hang on polling, the script will get terminated.

  for (var index in mqttTopics) {

    var topic     = mqttTopics[index];
    var fullTopic = '/echonetlite/'+ deviceName +'/'+ topic;

    if (topic.startsWith('hvac_state')) {
      var epc       = epcMapping[topic];
      var value     = await enlGetProperty(deviceAttributes.address, deviceAttributes.eoj, epc);

      console.log('Publishing ' + fullTopic + ' = ' + value.toString());

      // Preserve power state hack. We've avoided storing state in this app throughout
      // but because of how HomeAssistant handles on/off power states, we need to
      // know if the unit is powered or not to overwrite some of the modes that
      // we send back to Home Assistant. Otherwise we'll keep telling it that
      // it's in "heat mode" when it's off, since the unit maintains that state.
      if (epc == 0x80 /* Operation Status */) {
        // Save the per-device power state
        devices[deviceName]['powerState'] = value
      }
      if (epc == 0xB0 /* Operation Mode */|| epc == 0xA0 /* Airflow Rate/Fan Speed/Mode */) {
        // Fan mode or operating mode EPCs
        if (devices[deviceName]['powerState'] == false) {
          // We are powered down, let's override the value we send to HomeAssistant
          value = 'off';
          console.log('Publishing ' + fullTopic + ' = * corrected to: ' + value.toString());
        }
      }

      mqttClient.publish(fullTopic, value.toString(), {}, function(err){
        if (err) {
          showErrorExit("Error when publishing device status to MQTT");
        }
      });
    }
  }
}

function enlGetProperty(address, eoj, epc) {

  return new Promise(function(resolve, reject) {
    enlClient.getPropertyValue(address, eoj, epc, (err, res) => {

      if (err) {
        console.log("Unexpected error when setting device:"+ err);
        resolve(undefined);
      }

      // Uncomment for full raw output from library when debugging.
      //console.log(JSON.stringify(res));
      //console.log(JSON.stringify(res['message']['data']));

      // The ECHONET Lite library is helpful and packages the result in a named
      // key depending what data type it is, but we have some specific needs to
      // modify certain values in transit.
      switch (epc) {

        case 0xA0:
          var value = epcFanModes[ res['message']['data']['level'] ];
          break;

        case 0xB0:
          var value = epcOperatingModes[ res['message']['data']['mode'] ];
          break;

        default:
          // No idea what EPC this is, default to grabbing the first key in the
          // returned data.
          var result = res['message']['data']
          var value  = result[Object.keys(result)[0]];
          break;
      }

      resolve(value);
    });
  });
}


function enlSetProperty(address, eoj, epc, value) {

  return new Promise(function(resolve, reject) {

    // Need to prepare the EDT
    switch (epc) {
      case 0x80: // power on true/false

        // Convert Home Assistant defaults for power commands to booleans.
        if (value.toString().toLowerCase() == "off") { value = false }
        if (value.toString().toLowerCase() == "on")  { value = true }

        var edt = { 'status': value };
        break;

      case 0xB0: // operating modes

        if (value.toLowerCase() == "off" || value.toLowerCase() == "on") {
          console.log("Operating modes on/off unsupported, ignoring. Controlling with power mode instead.");
          // Home Assistant sets this mode on power on/off even though it also
          // calls us with 0x80 above to enable/disable power. Annoying.
          resolve(undefined);
          return; // Dunno why, but resolve() on it own doesn't terminate execution.
        }

        var edt = { 'mode': epcOperatingModes.indexOf(value) };
        break;

      case 0xB3: // target temp
        var edt = { 'temperature': parseInt(value) };
        break;

      case 0xA0: // fanmode
        if (value.toLowerCase() == "off") {
          console.log("Fan mode == off unsupported, ignoring.");
          // Home Assistant needs the concept of a fan mode == off, but we don't
          // support this with ECHONET Lite, so we just ignore.
          resolve(undefined);
          return; // Dunno why, but resolve() on it own doesn't terminate execution.
        }

        // What we should have:
        // var edt = { 'level': epcFanModes.indexOf(value) };

        // What we actually have:
        /* We use a cut down set of fanmodes for mapping here to work
         * specifically with Mitsubishi's wierd fan levels. This might not port
         * to other vendors, so if it annoys you, please send a PR with a
         * solution that works for multiples... I fear we may need to implement
         * a "traits" mode or something for different brands.
        */
        switch (value.toLowerCase()) {
          case 'auto':
            var edt = { 'level': 0 };
            break;
          case 'quiet':
            var edt = { 'level': 1 };
            break;
          case 'low':
            var edt = { 'level': 2 };
            break;
          case 'medium':
            var edt = { 'level': 3 };
            break;
          case 'high':
            var edt = { 'level': 5 };
            break;
          case 'super high':
            var edt = { 'level': 6 };
            break;
          default:
            var edt = { 'level': 2 }; // default to low
            break;
        }

        break;
    }

    console.log("Setting device to: "+ JSON.stringify(edt));
    enlClient.setPropertyValue(address, eoj, epc, edt, (err, res) => {
      if (err) {
        console.log("Unexpected error when setting device:"+ err);
        resolve(undefined);
      }

      // Note: we don't bother grabbing return data, we'll leave it for the
      // regular polling to confirm that the change went through as expected.
    });

    resolve(edt);
  });
}


// Helper Functions
function showErrorExit(err) {
  console.log('[ERROR] '+ err.toString());
  process.exit();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

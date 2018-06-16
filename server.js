/*
 * ECHONET Lite AC MQTT Service
 *
 * This service syncs information between ECHONET Lite HVAC devices and MQTT
 * for integration with home automation systems.
 *
 * Copyright 2018 Jethro Carr
 * See LICENSE file for MIT license conditions.
 *
 */


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
  console.log("Successfully established MQTT connection");
})

mqttClient.on('reconnect', function () {
  // This will fire repeatedly if the MQTT configuration is wrong and unable to
  // establish a connection. If you're seeing it non-stop, your config is wrong.
  console.log("Reconnecting to MQTT");
})

mqttClient.on('error', function () {
  console.log("An error occured talking with MQTT");
})


// Establish the ECHONET Lite connection.
var discoveryTime = process.env.DISCOVERY_TIME || 10;
var pollFrequency = process.env.POLL_FREQUENCY || 30;

var EchonetLite = require('node-echonet-lite');
var enlClient  = new EchonetLite({'type': 'lan'});


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

enlClient.init((err) => {

  if (err) {
    showErrorExit(err);
  } else {
    // We run the discovery process for a fixed duration, then process all
    // discovered devices in parallel.
    console.log("Running ECHONET Lite discovery (" + discoveryTime + " seconds)");

    //var devices = {}
    //discoverDevices(devices);
    var devices = {
      'testA': {
        address: 'aaaa'
      },
      'testB': {
        address: 'bbb'
      }
    };

    setTimeout(async function() {
      console.log("Discovery completed");

      // Stop further discovery
      //enlClient.stopDiscovery();

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
      name = address.replace("/\./g", "-");

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
  console.log(JSON.stringify(deviceAttributes)) // TODO: remove


  // TODO: Write me
  await sleep(2000); // dummy load
  console.log("done");
}

// Poll devices for current status
function pollDevice(device) {
  console.log("polling device "+ device)

  // TODO: Write me
}

// Helper Functions
function showErrorExit(err) {
  console.log('[ERROR] '+ err.toString());
  process.exit();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

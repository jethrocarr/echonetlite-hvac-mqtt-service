# ECHONET Lite HVAC MQTT service

ECHONET Lite is a protocol used by some smart home appliances originating in
Japan. This application listens to your local network for ECHONET Lite HVAC
(heat pump / air conditioning) appliances and then feeds their status to a MQTT
service. It also subscribes to MQTT to listen for commands back to perform
actions such as changing temperature or changing modes (heat vs cool vs off).

It's primary design is to facilitate integration between Mitsubishi MAC-568IF-E
Wifi Controllers and the popular home automation software [Home Assistant](https://www.home-assistant.io/),
but it's not exclusive to that platform or hardware and could be used by
anything that can read and write to MQTT and any HVAC hardware that supports
the ECHONET Lite protocol.


# Tested Hardware

* Mitsubishi MAC-568IF-E adaptors (popular in NZ/AU).
  * Note that you must enable the ECHONET Lite protocol via the settings
    interface in the official WiFi control application before it will work.
  * At this time, the optional Lossnay ventilation unit does not appear to be
    exposed or be controllable via this protocol (it's also not exposed to the
    official wifi app either).
  * Supported models:
    * Mitsubishi PEAD-RP140JAA (Ducted Heat Pump)

Just because a model isn't listed, doesn't mean it won't work. In theory any
model that supports ECHONET Lite properly should work (yay standards!), however
select features might not have corresponding logic in this application.

PRs are most welcome, even if it's simply to add a particular model to this
tested hardware list with 0 code changes needed. It's helpful for others out
there to know if their device is supported.


# Incompatible Hardware

The following is a list of hardware that seems like it should work with this
application, but for various reasons don't:

* Mitsubishi MAC-559IF-E & MAC-558IF-E
   * Only MAC-568IF-E (and presumably newer?) has the additional support for the
    ECHONET Lite protocol, older models are out of luck unless Mitsubishi
    suddenly decide to backport it to these older gens.
   * There are some POCs for doing control of any of the Mitsubishi wifi control
     devices using the upstream cloud API (Melview) which would work with these
     older units, but they will need some polish and Melview seems to have a
     habit of blocking IPs that try to poll too often. Take a look at the
     following POCs for some reference material:
      * https://github.com/NovaGL/diy-melview
      * https://github.com/lennyby93/node-mmcontrol
      * https://github.com/delwinbest/homeassistant_mitsubishi_hvac
   * These older units do feature an HTTP interface that people have been trying
     to figure out that could offer a way of integrating locally, take a look at
     https://github.com/NovaGL/diy-melview/issues/2 for comments there.


# Configuration & Operation

This application includes a Dockerfile and the easiest way to run it is to build
and execute inside Docker due to the complexities of getting the right Node
versions.

     docker build -t jethrocarr/echonetlite-hvac-mqtt:latest .

Or pull from my repository, I have two pre-build images - one for x86_64 and one
for 32-bit ARM for those running devices such as the Raspberry Pi.

    docker pull jethrocarr/echonetlite-hvac-mqtt:latest      # x86_64
    docker pull jethrocarr/echonetlite-hvac-mqtt:latest-arm  # arm

Configuration is minimal - you must set an MQTT URL that the application uses to
send all updates and subscribe for changes.

Discovery of the ECHONET Lite devices is automated - at launch the application
listens to the network for device discovery.

Simplest possible invocation:

    docker run --rm --network host \
    -e MQTT_URL=mqtt://homeassistant:API_PASSWORD_HERE@localhost:1883 \
    jethrocarr/echonetlite-hvac-mqtt:latest

Or to be more secure, you should put the ENVs into a private file to avoid
exposing them on `ps aux` to other users/processes on the server running the
container:

     cat > /etc/echonetlite-hvac-mqtt.envs << EOF
     MQTT_URL=mqtt://homeassistant:API_PASSWORD_HERE@localhost:1883
     EOF
     chmod 600 /etc/echonetlite-hvac-mqtt.envs

     docker run --rm --network host \
     --env-file /etc/echonetlite-hvac-mqtt.envs \
     jethrocarr/echonetlite-hvac-mqtt:latest

If anything goes wrong in the app, it'll probably just crash. You will want to
use an init system that can automatically re-start the application such as
systemd or utilize the Docker `--restart always` argument.

The end result is data being published to MQTT. We use the device IP address as
it's unique name, so it is recommended to setup your DHCP server to grant a
static lease to your devices so that their IP address does not change.

The application will start listening on `UDP` port `3610` - please make sure you
open up your firewall to permit inbound requests, eg:

    iptables -I INPUT -p udp --dport 3610 -j ACCEPT


# Using with Home Assistant

The following is an example of configuring the
[MQTT HVAC component](https://www.home-assistant.io/components/climate.mqtt/)
in Home Assistant to work with the MQTT structure created by this application:

    climate:
      - platform: mqtt
        unique_id: "DEVICE_MAC_ADDRESS"
        name: Heatpump
        power_command_topic: /echonetlite/DEVICE_NAME_HERE/hvac_command_power
        mode_command_topic: /echonetlite/DEVICE_NAME_HERE/hvac_command_mode
        mode_state_topic: /echonetlite/DEVICE_NAME_HERE/hvac_state_mode
        fan_mode_command_topic: /echonetlite/DEVICE_NAME_HERE/hvac_command_fanmode
        fan_mode_state_topic: /echonetlite/DEVICE_NAME_HERE/hvac_state_fanmode
        current_temperature_topic: /echonetlite/DEVICE_NAME_HERE/hvac_state_room_temperature
        temperature_command_topic: /echonetlite/DEVICE_NAME_HERE/hvac_command_target_temperature
        temperature_state_topic: /echonetlite/DEVICE_NAME_HERE/hvac_state_target_temperature
        #
        # Only needed if your unit supports more than the default fan modes
        #
        fan_modes:
          - "auto"
          - "off"
          - "quiet"
          - "low"
          - "medium"
          - "high"
          - "super high"

You can confirm the topic names by observing this application's runtime output.

To talk to Home Assistant, this application must be able to connect on TCP port
1883 to the MQTT server being used. If using the default embedded Home Assistant
MQTT server, the configuration string will be:

    export MQTT_URL='mqtt://homeassistant:API_PASSWORD_HERE@localhost:1883'

Set the appropriate password for `API_PASSWORD_HERE` (generally the same as the
web interface) and if your setup is not all running locally on the same host,
make sure to set the appropriate hostname/IP in place of `localhost` and ensure
that TCP port 1883 is open and reachable.


# Using with Apple HomeKit

It's possible to expose the HVAC unit to HomeKit by using Home Assisant with
the additional HomeKit component enabled. HomeKit's support does not have
feature parity with ECHONET Lite protocol (currently) so certain features such
as fan speed control and "fan only" mode are not supported. The core functions
of on/off, heat, cool and showing temperature works fine.

Note: There is no speed for exposing/controlling fan speed with Homekit via
Home Assistant currently - refer to the ticket explaining the issues and
progress on this at: https://github.com/home-assistant/architecture/issues/27



# All configuration options

| Environmental        | Example                                               | Details                                                                                            |
|----------------------| ------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| MQTT_URL             | mqtt://homeassistant:API_PASSWORD_HERE@localhost:1883 | MQTT server & creds to use.                                                                        |
| DISCOVERY_TIME       | 10                                                    | How long to search for devices on the LAN at startup                                               |
| POLL_FREQUENCY       | 30                                                    | How often to ask devices for current status                                                        |
| WATCHDOG_TIMER       | 60                                                    | Timer for detecting hung connections & restarting                                                  |
| NUM_EXPECTED_DEVICES | 2                                                     | Will cause early termination if the number of devices discovered doesn't match the expected number |

# Troubleshooting

If you see `Reconnecting to MQTT` constantly and aren't getting anything in
MQTT, it means your config is probably wrong and the app is unable to establish
a connection. For some reason the mqtt node library doesn't seem particularly
communicative about errors and why they're happening, so any incorrect config
just results in repeat reconnects without reasons being stated.

If you are not able to discover any devices, check that you are not blocking
traffic into your server on `UDP` port `3610` - as the discovery process is a
listener, it's important it's able to actually receive traffic from the LAN.


# Why not a native Python component for Home Assistant?

The primary goal of this project was to control my MAC-568IF-E with Home
Assistant. Ideally this would be a native component, but as the Node library was
(at the time of developing it) the only decent ECHONET Lite library I could find
in English, writing a Python version was too large a task for my own personal
need. So it made more sense to interact with Home Assistant using MQTT instead.

If someone wants to build a native component, please do! Use this code and it's
dependent node module as a reference and also take a look at
https://github.com/keiichishima/echonetlite for a POC ECHONET Lite library in
Python which might be a good place to start.


# Thanks

Big thanks to Futomi Hatano for open sourcing a high quality and extremely well
documented ECHONET Lite library that this application relies on for doing all
the hard work: https://github.com/futomi/node-echonet-lite

This library includes [some extremely good documentation that summaries the spec
for HVAC systems](https://github.com/futomi/node-echonet-lite/blob/master/EDT-01.md).


# Bugs, PRS, Contributions

Please submit any bugs/issues/questions on the Github issue tracker only. PRs
and other code contributions are always welcome, especially if they fix a bug
you've found ;-)


# License

This application is licensed under a MIT license, refer to `LICENSE` for
details.

# ECHONET Lite AC MQTT service

ECHONET Lite is a protocol used by some smart home appliances originating in
Japan. This application listens to your local network for ECHONET Lite air
conditioning (heat pump) appliances and then feeds their status to an MQTT
service. It also subscribes to MQTT to listen for commands back to perform
actions such as changing temperature or changing modes (heat vs cool vs off).

It's primary design is to facilitate integration with the popular Home Assistant
home automation application.


# Tested Hardware

* Mitsubishi MAC-568IF-E adaptors (popular in NZ/AU).
  * Note that you must enable the ECHONET Lite protocol via the settings
    interface in the official WiFi control application before it will work.
  * Supported models:
    * Mitsubishi PEAD-RP140JAA (Ducted Heat Pump)

Just because a model isn't listed, doesn't mean it won't work. In theory any
model that supports ECHONET Lite properly should work (yay standards!), however
select features might not have corresponding logic in this application.

PRs are most welcome, even if it's simply to add a particular model to this
tested hardware list with 0 code changes needed. It's helpful for others out
there to know if their device is supported.


# Incompatible Hardware

* Mitsubishi MAC-559IF-E & MAC-558IF-E - only MAC-568IF-E has the additional
  support for the ECHONET Lite protocol (as of time of writing).


# Configuration & Operation

This application includes a Dockerfile and the easiest way to run it is to build
and execute inside Docker due to the complexities of getting the right Node
versions.

TODO: Build instructions here

Configuration is minimal - you must set an MQTT URL that the application uses to
send all updates and subscribe for changes.

Discovery of the ECHONET Lite devices is automated - at launch the application
listens to the network for device discovery.

TODO: Config & Launch Example

If anything goes wrong in the app, it'll probably just crash. You will want to
use an init system that can automatically re-start the application such as
systemd or utilize the Docker `--restart always` argument.

The end result is data being published to MQTT. We use the device IP address as
it's unique name, so it is recommended to setup your DHCP server to grant a
static lease to your devices so that their IP address does not change.


# Using with Home Assistant

The primary goal of this project was to control my MAC-568IF-E with Home
Assistant. Ideally this would be a native component, but as the Node library was
(at the time of developing it) the only decent ECHONET Lite library I could find
in English, writing a Python version was too large a task for my own personal
need. So it made more sense to interact with Home Assistant using MQTT instead.

The following is an example of configuring the MQTT HVAC component in Home
Assistant to work with the MQTT structure created by this application:

TODO: Example config here.

To talk to Home Assistant, this application must be able to connect on TCP port
1883 to the MQTT server being used. If using the default embedded Home Assistant
MQTT server, the configuration string will be:

    export MQTT_URL='mqtt://homeassistant:API_PASSWORD_HERE@localhost:1883'

Set the appropriate password for `API_PASSWORD_HERE` and if your setup is not
all local, make sure to set the appropriate hostname/IP in place of `localhost`
and ensure that TCP port 1883 is open and reachable.


# All configuration options

| Environmental  | Example                                               | Details                                              |
|----------------| ------------------------------------------------------|------------------------------------------------------|
| MQTT_URL       | mqtt://homeassistant:API_PASSWORD_HERE@localhost:1883 | MQTT server & creds to use.                          |
| DISCOVERY_TIME | 10                                                    | How long to search for devices on the LAN at startup |
| POLL_FREQUENCY | 30                                                    | How often to ask devices for current status          |


# Troubleshooting

If you see `Reconnecting to MQTT` constantly and aren't getting anything in
MQTT, it means your config is probably wrong and the app is unable to establish
a connection.


# Thanks

Big thanks to Futomi Hatano for open sourcing a high quality and extremely well
documented ECHONET Lite library that this application relies on for doing all
the hard work: https://github.com/futomi/node-echonet-lite

This library includes
(https://github.com/futomi/node-echonet-lite/blob/master/EDT-01.md)[some
extremely good documentation that summaries the spec for HVAC systems].


# License

This application is licensed under a MIT license, refer to `LICENSE` for
details.

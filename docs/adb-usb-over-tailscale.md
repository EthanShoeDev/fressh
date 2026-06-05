# ADB Over USB From a Remote Machine

Use this when the Android device is plugged into a host machine by USB, but
development is happening on a remote SSH/VM machine. The host owns the USB
connection. The remote machine talks to the host's ADB server over Tailscale.

This avoids Android wireless debugging.

## What You Need

Host machine:

- Tailscale installed and connected to the same tailnet as the remote machine.
- Android platform-tools installed (`adb` available).
- Android device connected by USB.
- USB debugging enabled on the Android device.
- Firewall allows TCP `5037` from Tailscale addresses only.

Remote machine:

- Tailscale installed and connected to the same tailnet.
- Android platform-tools installed (`adb` available).
- The host machine's Tailscale IP.

Set these values before using the commands:

```text
HOST_TAILSCALE_IP=<host-tailscale-ip>
DEVICE_SERIAL=<adb-device-serial>
EXPECTED_MODEL=<android-device-model>
APP_PACKAGE=com.finalapp.vibe2
```

## Host Setup

Host summary:

1. Plug the Android device into the host by USB.
2. Start the host ADB server with `adb -a -P 5037 start-server`.
3. Add a host firewall rule that allows TCP `5037` from Tailscale only.
4. Give the remote machine the host's Tailscale IP.

### 1. Connect and Authorize the Device

Plug the Android device into the host by USB.

On the Android device:

1. Enable Developer options.
2. Enable USB debugging.
3. Approve the USB debugging prompt when it appears.

On the host:

```powershell
adb kill-server
adb devices -l
```

Expected result:

```text
<adb-device-serial>  device  ... model:<android-device-model> ...
```

If the device says `unauthorized`, approve the prompt on the device and run
`adb devices -l` again.

### 2. Start ADB on the Tailscale Interface

On the host:

```powershell
adb kill-server
adb -a -P 5037 start-server
adb devices -l
```

Confirm the ADB server is listening:

```powershell
netstat -ano | findstr :5037
```

Expected listener:

```text
0.0.0.0:5037  LISTENING  <pid>
```

### 3. Allow Tailscale Through the Host Firewall

On a Windows host, run PowerShell as Administrator:

```powershell
New-NetFirewallRule `
  -DisplayName "ADB Server over Tailscale" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 5037 `
  -RemoteAddress 100.64.0.0/10
```

This scopes ADB access to the Tailscale CGNAT range only. Do not expose port
`5037` to the public internet or a whole LAN.

For a macOS or Linux host, use the equivalent local firewall tool and allow only
Tailscale peers to reach TCP `5037`.

Check the host Tailscale IP:

```powershell
tailscale ip -4
```

## Remote Setup

On the remote machine:

```bash
export HOST_TAILSCALE_IP=<host-tailscale-ip>
export ADB_SERVER_SOCKET=tcp:$HOST_TAILSCALE_IP:5037
adb devices -l
```

Expected result:

```text
<adb-device-serial>  device  ... model:<android-device-model> ...
```

Confirm the device model:

```bash
adb shell getprop ro.product.model
```

Expected result:

```text
<android-device-model>
```

Add the export to your shell session before running ADB commands:

```bash
export ADB_SERVER_SOCKET=tcp:$HOST_TAILSCALE_IP:5037
```

For one-off commands:

```bash
ADB_SERVER_SOCKET=tcp:$HOST_TAILSCALE_IP:5037 adb devices -l
```

## Start Working

Install the latest APK:

```bash
export HOST_TAILSCALE_IP=<host-tailscale-ip>
export ADB_SERVER_SOCKET=tcp:$HOST_TAILSCALE_IP:5037
export APP_PACKAGE=com.finalapp.vibe2
adb install -r apps/mobile/build-*.apk
```

Launch the app:

```bash
adb shell monkey -p $APP_PACKAGE -c android.intent.category.LAUNCHER 1
```

Check the installed app version:

```bash
adb shell dumpsys package $APP_PACKAGE | rg "versionName|versionCode|lastUpdateTime"
```

Watch app logs:

```bash
PID=$(adb shell pidof -s $APP_PACKAGE | tr -d '\r')
adb logcat --pid="$PID"
```

Take a screenshot:

```bash
adb shell screencap -p /sdcard/fressh.png
adb pull /sdcard/fressh.png /tmp/fressh.png
```

## Troubleshooting

If the remote cannot see the device:

```bash
export HOST_TAILSCALE_IP=<host-tailscale-ip>
export ADB_SERVER_SOCKET=tcp:$HOST_TAILSCALE_IP:5037
adb devices -l
```

Then check the host:

```powershell
adb devices -l
netstat -ano | findstr :5037
tailscale ip -4
```

If the device is `unauthorized`, approve the USB debugging prompt on the
Android device.

If port `5037` is not listening on `0.0.0.0`, restart ADB on the host:

```powershell
adb kill-server
adb -a -P 5037 start-server
```

If the remote cannot connect to the host, confirm both machines are on
Tailscale:

```bash
tailscale status
```

If ADB behaves strangely, compare platform-tools versions on host and remote:

```bash
adb version
```

When `ADB_SERVER_SOCKET` points at the host, `adb kill-server` from the remote
can stop the host's ADB server. Prefer restarting ADB on the host.

Avoid running Android wireless debugging and USB-over-host ADB at the same time
for the same device.

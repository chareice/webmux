#!/usr/bin/env python3
"""Exercise a built APK's real WebView startup on a disposable Android emulator."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("apk", type=Path)
parser.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL", "emulator-5554"))
parser.add_argument("--output", type=Path, default=Path("/tmp/offdesk-android-startup"))
args = parser.parse_args()
# This test deliberately installs fresh. Never let it clear a person's phone.
if not args.serial.startswith("emulator-"):
    parser.error("startup smoke requires a disposable emulator, never a physical device")
if not args.apk.is_file():
    parser.error(f"APK does not exist: {args.apk}")
args.output.mkdir(parents=True, exist_ok=True)


def adb(*command, timeout=30, check=True):
    return subprocess.run(
        ["adb", "-s", args.serial, *command], capture_output=True, text=True,
        timeout=timeout, check=check,
    ).stdout


def hierarchy():
    adb("shell", "rm", "-f", "/sdcard/offdesk-startup.xml")
    adb("shell", "uiautomator", "dump", "/sdcard/offdesk-startup.xml", timeout=15)
    xml = adb("shell", "cat", "/sdcard/offdesk-startup.xml")
    (args.output / "ui.xml").write_text(xml)
    return ET.fromstring(xml)


def wait_for_setup():
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            root = hierarchy()
            if any(n.get("text") == "Scan the code" for n in root.iter("node")):
                return root
        except (ET.ParseError, subprocess.SubprocessError):
            pass
        time.sleep(1)
    raise AssertionError("APK did not render its setup screen within 60 seconds (startup hang/ANR)")


try:
    assert adb("shell", "getprop", "sys.boot_completed").strip() == "1", "emulator is not booted"
    adb("uninstall", "dev.offdesk.desktop", check=False)
    adb("install", str(args.apk.resolve()), timeout=120)
    adb("logcat", "-c")
    adb("shell", "input", "keyevent", "82")
    adb("shell", "am", "start", "-W", "-n", "dev.offdesk.desktop/.MainActivity")
    root = wait_for_setup()
    field = next(n for n in root.iter("node") if n.get("class") == "android.widget.EditText")
    left, top, right, bottom = map(int, re.findall(r"\d+", field.attrib["bounds"]))
    adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
    adb("shell", "input", "text", "http://example.invalid")
    assert any("example.invalid" in n.get("text", "") for n in hierarchy().iter("node")), "WebView input is unresponsive"
    adb("shell", "input", "keyevent", "3")
    adb("shell", "am", "start", "-W", "-n", "dev.offdesk.desktop/.MainActivity")
    # Cross both the JavaScript and native automatic-update timers.
    time.sleep(10)
    wait_for_setup()
    print("PASS: APK cold start, WebView input, and foreground after update checks", flush=True)
finally:
    (args.output / "logcat.txt").write_text(adb("logcat", "-d", check=False))
    with (args.output / "screen.png").open("wb") as screenshot:
        subprocess.run(["adb", "-s", args.serial, "exec-out", "screencap", "-p"], stdout=screenshot, timeout=15, check=False)

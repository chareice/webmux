#!/usr/bin/env python3
"""Exercise the signed APK on a disposable, rooted Android emulator."""
import argparse
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = "dev.offdesk.desktop"
ACTIVITY = f"{PACKAGE}/.MainActivity"
DATA = f"/data/user/0/{PACKAGE}"


def adb(*args, timeout=30):
    return subprocess.run(["adb", *args], check=True, capture_output=True, timeout=timeout).stdout.decode()


def launch():
    adb("shell", "am", "force-stop", PACKAGE)
    adb("shell", "am", "start", "-W", "-n", ACTIVITY)


def wait_screen(text, output, label):
    deadline = time.monotonic() + 45
    last = ""
    while time.monotonic() < deadline:
        try:
            adb("shell", "uiautomator", "dump", "/sdcard/offdesk-smoke.xml", timeout=12)
            last = adb("shell", "cat", "/sdcard/offdesk-smoke.xml")
            tree = ET.fromstring(last)
            if any(text in (n.get("text", "") + n.get("content-desc", "")) for n in tree.iter("node")):
                (output / f"{label}.xml").write_text(last)
                with (output / f"{label}.png").open("wb") as screenshot:
                    subprocess.run(["adb", "exec-out", "screencap", "-p"], check=True, stdout=screenshot, timeout=15)
                return tree
        except (subprocess.SubprocessError, ET.ParseError) as error:
            last = str(error)
        time.sleep(1)
    (output / f"{label}-failure.txt").write_text(last)
    raise RuntimeError(f"App did not render {text!r} during {label}")


def tap_text(tree, text):
    for node in tree.iter("node"):
        if text in (node.get("text", "") + node.get("content-desc", "")):
            bounds = [int(x) for x in re.findall(r"\d+", node.get("bounds", ""))]
            if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                adb("shell", "input", "tap", str((bounds[0]+bounds[2])//2), str((bounds[1]+bounds[3])//2))
                return
    raise RuntimeError(f"No visible control for {text!r}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("apk")
    parser.add_argument("--output", default="android-smoke")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    adb("root")
    adb("wait-for-device")
    assert adb("shell", "id", "-u").strip() == "0", "Use a disposable userdebug emulator"
    adb("install", "-r", args.apk, timeout=90)
    # Only the emulator's test installation is cleared, never a user's phone.
    adb("shell", "pm", "clear", PACKAGE)
    adb("logcat", "-c")
    try:
        launch()
        wait_screen("Scan the code", output, "fresh-start")
        adb("shell", "am", "force-stop", PACKAGE)
        # A damaged durable marker must still retain encrypted mode, render
        # recovery, and never fall back to the old Hub. No real keys are used.
        adb("shell", f"printf '{{}}' > {DATA}/secure-connection.json")
        adb("shell", f"printf '%s' '{{\"hub_url\":\"http://127.0.0.1:9\"}}' > {DATA}/hub.json")
        uid = adb("shell", "stat", "-c", "%u", DATA).strip()
        for name in ["secure-connection.json", "hub.json"]:
            adb("shell", "chown", f"{uid}:{uid}", f"{DATA}/{name}")
            adb("shell", "restorecon", f"{DATA}/{name}")
        # Replace the installed package without deleting its pairing marker.
        adb("install", "-r", args.apk, timeout=90)
        assert adb("shell", "cat", f"{DATA}/secure-connection.json").strip() == "{}"
        launch()
        tree = wait_screen("Forget connection and pair again", output, "retained-pairing")
        tap_text(tree, "Try again")
        time.sleep(2)
        wait_screen("Forget connection and pair again", output, "recovery-reload")
        launch()
        wait_screen("Forget connection and pair again", output, "paired-cold-start")
        print("Android signed-APK startup/recovery smoke passed", flush=True)
    finally:
        (output / "logcat.txt").write_text(adb("logcat", "-d", timeout=20))


if __name__ == "__main__":
    main()

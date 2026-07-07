#!/usr/bin/env python3
"""Generiert die Launcher-Icons aus /opt/TimeFeed/client/public/icons/icon-512.png.

- ic_launcher.png       : Legacy-Icon, Quelle auf Orange (#EA580C) komponiert
- ic_launcher_foreground: Adaptive-Icon-Foreground (transparent, Motiv in der
                          Safe-Zone ~66% der Flaeche zentriert)

Aufruf: python3 tools/gen_icons.py  (aus dem Projektordner; wird von build.sh
bei fehlenden Icons automatisch ausgefuehrt)
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SOURCE = "/opt/TimeFeed/client/public/icons/icon-512.png"
BACKGROUND = (0xEA, 0x58, 0x0C, 0xFF)  # TimeFeed-Orange

# dpi-Bucket -> (Launcher-Groesse, Foreground-Groesse)
SIZES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}


def main():
    src = Image.open(SOURCE).convert("RGBA")

    for bucket, (launcher, foreground) in SIZES.items():
        outdir = os.path.join(PROJECT, "res", f"mipmap-{bucket}")
        os.makedirs(outdir, exist_ok=True)

        # Legacy-Launcher-Icon: Motiv auf Orange, volle Flaeche.
        bg = Image.new("RGBA", (launcher, launcher), BACKGROUND)
        icon = src.resize((launcher, launcher), Image.LANCZOS)
        bg.alpha_composite(icon)
        bg.save(os.path.join(outdir, "ic_launcher.png"))

        # Adaptive-Foreground: transparente 108dp-Flaeche, Motiv in der
        # Safe-Zone (66% des Canvas) zentriert.
        canvas = Image.new("RGBA", (foreground, foreground), (0, 0, 0, 0))
        inner = int(foreground * 0.66)
        fg_icon = src.resize((inner, inner), Image.LANCZOS)
        offset = (foreground - inner) // 2
        canvas.alpha_composite(fg_icon, (offset, offset))
        canvas.save(os.path.join(outdir, "ic_launcher_foreground.png"))

        print(f"mipmap-{bucket}: ic_launcher {launcher}px, foreground {foreground}px")


if __name__ == "__main__":
    main()

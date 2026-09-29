# -*- coding: utf-8 -*-
"""用 ctypes + Win32 API 截全屏,输出 PNG(无需 PIL)"""
import ctypes, ctypes.wintypes as wt, struct, zlib, sys, os

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN = 76, 77
SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 78, 79

x = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
y = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
w = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
h = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)

hdesktop = user32.GetDC(0)
hdc = gdi32.CreateCompatibleDC(hdesktop)
hbmp = gdi32.CreateCompatibleBitmap(hdesktop, w, h)
gdi32.SelectObject(hdc, hbmp)
gdi32.BitBlt(hdc, 0, 0, w, h, hdesktop, x, y, 0x00CC0020)  # SRCCOPY

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG),
                ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]

bmi = BITMAPINFOHEADER()
bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
bmi.biWidth = w
bmi.biHeight = -h   # top-down
bmi.biPlanes = 1
bmi.biBitCount = 32
bmi.biCompression = 0  # BI_RGB

buf = ctypes.create_string_buffer(w * h * 4)
gdi32.GetDIBits(hdc, hbmp, 0, h, buf, ctypes.byref(bmi), 0)

rows = []
for i in range(h):
    row = bytearray([0])
    base = i * w * 4
    row += buf.raw[base:base + w * 4]  # BGRA
    rows.append(bytes(row))

# 释放资源
gdi32.DeleteObject(hbmp)
gdi32.DeleteDC(hdc)
user32.ReleaseDC(0, hdesktop)

def chunk(tag, data):
    c = struct.pack('>I', len(data)) + tag + data
    return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

# BGRA → RGBA 交换 R/B
raw = bytearray()
for r in rows:
    px = bytearray(r[1:])
    px[0::4], px[2::4] = px[2::4], px[0::4]
    raw += bytes([0]) + bytes(px)

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
       + chunk(b'IEND', b''))

out = sys.argv[1] if len(sys.argv) > 1 else 'screen.png'
with open(out, 'wb') as f:
    f.write(png)
print('saved:', os.path.abspath(out), w, 'x', h)

# -*- coding: utf-8 -*-
"""
生成 QuickDock 应用图标(纯 Python 手写 PNG,无需 PIL)
输出:build/icon.png (256x256,圆角方块 + 蓝紫渐变 + 白色 Dock 条)
"""
import struct, zlib, math, os

SIZE = 256

def lerp(a, b, t): return a + (b - a) * t

def rounded_rect_mask(x, y, r=56):
    """圆角矩形掩码:圆角半径 56px"""
    if x < r and y < r: return (x - r) ** 2 + (y - r) ** 2 <= r * r
    if x > SIZE - 1 - r and y < r: return (x - (SIZE - 1 - r)) ** 2 + (y - r) ** 2 <= r * r
    if x < r and y > SIZE - 1 - r: return (x - r) ** 2 + (y - (SIZE - 1 - r)) ** 2 <= r * r
    if x > SIZE - 1 - r and y > SIZE - 1 - r: return (x - (SIZE - 1 - r)) ** 2 + (y - (SIZE - 1 - r)) ** 2 <= r * r
    return True

def gradient(x, y):
    """蓝紫渐变:左上 #4F8CFF → 右下 #8C6FFF"""
    t = (x + y) / (2 * SIZE)
    r = lerp(0x4F, 0x8C, t)
    g = lerp(0x8C, 0x6F, t)
    b = lerp(0xFF, 0xFF, t)
    return int(r), int(g), int(b)

def in_dock(cx, cy):
    """中央 Dock 条:圆角横条 172x56"""
    x, y = cx - 128, cy - 128
    dx = max(abs(x) - (172/2 - 28), 0)
    dy = max(abs(y) - (56/2 - 28), 0)
    return dx*dx + dy*dy <= 28*28

def in_dot(cx, cy):
    """Dock 上 4 个小圆孔"""
    x, y = cx - 128, cy - 128
    for dx0 in (-45, -15, 15, 45):
        if (x - dx0) ** 2 + (y - 0) ** 2 <= 10 ** 2:
            return True
    return False

def build():
    rows = []
    for y in range(SIZE):
        row = bytearray([0])  # filter type 0
        for x in range(SIZE):
            cx, cy = x + 0.5, y + 0.5
            if not rounded_rect_mask(x, y):
                row += bytes([0, 0, 0, 0]); continue
            r, g, b = gradient(x, y)
            a = 255
            if in_dock(cx, cy):
                # Dock 条:半透明白
                r, g, b = 255, 255, 255
                a = 235 if not in_dot(cx, cy) else 60
            row += bytes([r, g, b, a])
        rows.append(bytes(row))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
    out = os.path.join(os.path.dirname(__file__), '..', 'build', 'icon.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(png)
    print('icon written:', os.path.abspath(out), len(png), 'bytes')

if __name__ == '__main__':
    build()

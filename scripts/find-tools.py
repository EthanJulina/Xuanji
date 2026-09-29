# -*- coding: utf-8 -*-
"""
lnk 目标解析调试脚本(轻量 Shell Link 二进制解析,无需依赖)
用法:
    python scripts/find-tools.py <某个.lnk文件路径>
不传参数时输出用法说明。
"""
import os, struct, sys

def parse_lnk(path):
    """解析 lnk 的本地目标路径(网络/UNC 目标返回 None)"""
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'\x00\x00\x00\x00' or len(data) < 76:
        return None
    flags = struct.unpack_from('<I', data, 20)[0]
    off = 76
    target = None
    # HasLinkInfo (0x01):解析 LinkInfo 里的本地路径
    if flags & 0x01:
        li_size = struct.unpack_from('<I', data, off)[0]
        li = data[off:off + li_size]
        if len(li) >= 28:
            local_off = struct.unpack_from('<I', li, 16)[0]
            if 0 < local_off < len(li):
                end = li.index(b'\x00\x00', local_off * 2)  # UTF-16 双字节
                target = li[local_off * 2:end].decode('utf-16-le', 'ignore')
    return target

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    lnk = sys.argv[1]
    if not os.path.exists(lnk):
        print('文件不存在:', lnk)
        sys.exit(1)
    print('LNK 目标:', parse_lnk(lnk) or '(网络/UNC 或未解析到本地路径)')

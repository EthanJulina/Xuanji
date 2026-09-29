# -*- coding: utf-8 -*-
"""
玄机 工具种子脚本:把常用工具批量写入 tools.json
- 幂等:按 targetPath 去重,重复执行不会产生重复条目
- 保留用户已有分类/工具,只追加缺失的

使用方法:把下方 CATEGORIES / TOOLS 清单改成你自己的工具后执行
    python scripts/seed-tools.py
"""
import json, os, sys

APP_DIR = os.path.join(os.environ['APPDATA'], '玄机')
TOOLS_JSON = os.path.join(APP_DIR, 'tools.json')

CATEGORIES = [
    {'id': 'cat-launcher', 'name': '快启脚本', 'emoji': '📜', 'color': '#4F8CFF', 'sortOrder': 1},
    {'id': 'cat-security', 'name': '安全测试', 'emoji': '🔐', 'color': '#E05F5F', 'sortOrder': 2},
    {'id': 'cat-dev',      'name': '开发工具', 'emoji': '💻', 'color': '#34B3A0', 'sortOrder': 3},
]

# ===== 示例清单(占位路径,请替换为你自己的工具)=====
# type 可选:exe / bat / cmd / lnk
T = r'C:\Tools'
TOOLS = [
    {'id': 'tool-example-exe', 'name': '示例工具', 'type': 'exe',
     'targetPath': T + r'\example\tool.exe',
     'desc': '示例:替换为你的工具路径', 'categoryId': 'cat-dev',
     'icon': 'auto', 'pinned': False, 'showWindow': True, 'runAsAdmin': False,
     'confirmBeforeRun': False, 'runCount': 0, 'lastRunAt': None, 'sortOrder': 1},
]

DEFAULT_SETTINGS = {
    'theme': 'dark', 'closeToTray': True, 'sortMode': 'manual', 'showDock': True
}

def main():
    os.makedirs(APP_DIR, exist_ok=True)
    # 读取现有配置(没有则用默认骨架)
    data = None
    if os.path.exists(TOOLS_JSON):
        try:
            with open(TOOLS_JSON, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print('现有配置解析失败,将重建:', e)
            data = None
    if not isinstance(data, dict):
        data = {'version': '1.1', 'categories': [], 'tools': [],
                'settings': dict(DEFAULT_SETTINGS)}

    data.setdefault('version', '1.1')
    data.setdefault('categories', [])
    data.setdefault('tools', [])
    data.setdefault('settings', dict(DEFAULT_SETTINGS))

    # 合并分类(按 id 去重)
    have_ids = {c['id'] for c in data['categories']}
    for cat in CATEGORIES:
        if cat['id'] not in have_ids:
            data['categories'].append(cat)
    # 重新排列 sortOrder(保持用户自定义分类靠后)
    next_order = max([c.get('sortOrder', 0) for c in data['categories']] + [0])
    for cat in CATEGORIES:
        c = next(x for x in data['categories'] if x['id'] == cat['id'])
        if not c.get('sortOrder'):
            next_order += 1
            c['sortOrder'] = next_order

    # 合并工具(按 targetPath 去重)
    have_paths = {t.get('targetPath') for t in data['tools']}
    added, skipped = [], []
    for tool in TOOLS:
        if tool['targetPath'] in have_paths:
            skipped.append(tool['name'])
            continue
        # 目标文件存在性校验,缺失的条目照加但打印警告(用户可自行修复)
        if not os.path.exists(tool['targetPath']):
            print(f'[警告] 目标不存在,仍添加(运行时会友好提示):{tool["targetPath"]}')
        data['tools'].append(tool)
        added.append(tool['name'])

    # 原子写入:tmp → rename
    tmp = TOOLS_JSON + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if os.path.exists(TOOLS_JSON):
        os.remove(TOOLS_JSON)
    os.rename(tmp, TOOLS_JSON)

    print(f'完成:新增 {len(added)} 个工具 {added}')
    if skipped:
        print(f'跳过(已存在):{skipped}')
    print(f'配置文件:{TOOLS_JSON}')
    print(f'分类数:{len(data["categories"])} 工具总数:{len(data["tools"])}')

if __name__ == '__main__':
    sys.exit(main())

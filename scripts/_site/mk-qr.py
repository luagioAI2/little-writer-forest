# -*- coding: utf-8 -*-
"""生成官网下载二维码。
⚠️ 域名变了要重跑这个脚本 —— 二维码里编的就是域名。
用法：python scripts/_site/mk-qr.py [https://your-domain.com]
"""
import os
import sys

import qrcode
from qrcode.constants import ERROR_CORRECT_M

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'website', 'assets')
os.makedirs(OUT, exist_ok=True)

# TODO-BEFORE-LAUNCH ① 域名：跟 index.html 的 canonical 保持一致
URL = sys.argv[1] if len(sys.argv) > 1 else 'https://www.example.com/download/xiaobimiao-android.apk'

qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=10, border=3)
qr.add_data(URL)
qr.make(fit=True)
img = qr.make_image(fill_color='#05271a', back_color='white').convert('RGB')
img.save(os.path.join(OUT, 'qr-download.png'), optimize=True)
print('二维码 ->', URL)
print('  qr-download.png', img.size)

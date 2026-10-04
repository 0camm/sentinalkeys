# update_index.py: patches the size + SHA-256 in index.html after a build.
# Usage: python update_index.py dist\Sentinel.exe index.html
import hashlib, os, re, sys

exe, page = sys.argv[1], sys.argv[2]
sha = hashlib.sha256(open(exe, 'rb').read()).hexdigest()
size = f'{os.path.getsize(exe) / 1024 / 1024:.1f} MB'

html = open(page, encoding='utf-8').read()
html, n1 = re.subn(r'(sha256:\s*")[0-9a-f]{64}(")', rf'\g<1>{sha}\2', html)
html, n2 = re.subn(r'(size:\s*")[^"]*(")', rf'\g<1>{size}\2', html)
if n1 != 1 or n2 != 1:
    sys.exit('Could not find the sha256/size fields in index.html')
open(page, 'w', encoding='utf-8').write(html)
print(f'Updated index.html -> {size}, SHA-256 {sha}')

#!/usr/bin/env node
// 补丁 8：skill-explorer 认软链（Dirent 对 symlink 描述链接自身，isDirectory/isFile 双 false 落 else-continue 被静默跳过）。
// 源码补丁已直接打在本机 explorer 实例；本脚本供升级/重装后幂等重放。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: node replay-skill-explorer-symlinks.mjs <lib/index.js>'); process.exit(1) }
let src = readFileSync(target, 'utf8')
if (src.includes('patch(symlink-support)')) { console.log('[skip] already patched:', target); process.exit(0) }

// 1) import stat
const impOld = 'import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";'
const impNew = 'import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";'
if (!src.includes(impOld)) throw new Error('import anchor missing in ' + target)
src = src.replace(impOld, impNew)

// 2) 扫描循环：软链 stat 跟链后再判型
const scanOld = [
  '\t\tif (entry.isDirectory()) file = join(root, name, "SKILL.md");',
  '\t\telse if (entry.isFile() && name.endsWith(".md")) file = join(root, name);',
  '\t\telse continue;',
].join('\n')
const scanNew = [
  '\t\t// patch(symlink-support): Dirent describes the link itself, so a symlinked',
  '\t\t// skill dir answered false to both isDirectory/isFile and fell into the',
  '\t\t// else-continue, silently vanishing from the explorer list.',
  '\t\tlet isDir = entry.isDirectory();',
  '\t\tlet isFile = entry.isFile();',
  '\t\tif (entry.isSymbolicLink()) {',
  '\t\t\ttry {',
  '\t\t\t\tconst st = await stat(join(root, name));',
  '\t\t\t\tisDir = st.isDirectory();',
  '\t\t\t\tisFile = st.isFile();',
  '\t\t\t} catch {',
  '\t\t\t\tcontinue; // dangling link',
  '\t\t\t}',
  '\t\t}',
  '\t\tif (isDir) file = join(root, name, "SKILL.md");',
  '\t\telse if (isFile && name.endsWith(".md")) file = join(root, name);',
  '\t\telse continue;',
].join('\n')
if (!src.includes(scanOld)) throw new Error('scan anchor missing in ' + target)
src = src.replace(scanOld, scanNew)
writeFileSync(target, src)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)

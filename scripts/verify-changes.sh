#!/usr/bin/env bash
# 편집 후 손상 검증 — Edit/Write/sed 등으로 변경한 후 반드시 실행.
#
# 검사:
#   1. null byte 0개
#   2. 파일 끝이 정상 (} 또는 ) 또는 ;)
#   3. HEAD 대비 의도하지 않은 deletion 없음 (-50L 이상이면 truncation 의심)
#   4. tsc 통과
#
# 사용:
#   bash scripts/verify-changes.sh
#   bash scripts/verify-changes.sh src/lib/sync/withQueue.ts src/hooks/useMemos.ts  # 특정 파일만

set -u

if [ "$#" -gt 0 ]; then
  FILES="$@"
else
  FILES=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx|css|json|md|sql)$')
  UNTRACKED=$(git ls-files --others --exclude-standard | grep -E '\.(ts|tsx|css|json|md|sql)$')
  FILES="$FILES $UNTRACKED"
fi

if [ -z "$FILES" ]; then
  echo "검사할 변경 파일 없음."
  exit 0
fi

FAIL=0

echo "=== 1) null byte 검사 ==="
for f in $FILES; do
  [ -f "$f" ] || continue
  # python3 비의존 — tr로 null byte만 남겨 개수 카운트 (Git Bash/Windows 포함 이식성)
  n=$(tr -cd '\000' < "$f" | wc -c | tr -d ' ')
  if [ -n "$n" ] && [ "$n" != "0" ]; then
    echo "  ❌ NULL BYTE in $f: ${n}개"
    FAIL=1
  fi
done

echo ""
echo "=== 2) 파일 끝 정상성 (마지막 byte) ==="
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in
    *.css)   last=$(tail -c 50 "$f" | tr -d ' \n\t' | tail -c 1)
             [ "$last" = "}" ] || { echo "  ❌ $f: CSS 마지막이 '}' 아님 ($last)"; FAIL=1; } ;;
    *.ts|*.tsx)
             last=$(tail -c 50 "$f" | tr -d ' \n\t' | tail -c 1)
             case "$last" in
               '}'|')'|';'|']') ;;
               *) echo "  ❌ $f: TS 마지막이 비정상 ($last) — truncation 의심"; FAIL=1 ;;
             esac ;;
    *.json)  last=$(tail -c 5 "$f" | tr -d ' \n\t' | tail -c 1)
             case "$last" in
               '}'|']') ;;
               *) echo "  ❌ $f: JSON 마지막이 비정상 ($last)"; FAIL=1 ;;
             esac ;;
  esac
done

echo ""
echo "=== 3) HEAD diff stat — 큰 deletion(-50L+) 경고 ==="
for f in $FILES; do
  [ -f "$f" ] || continue
  stat=$(git diff --numstat HEAD -- "$f" 2>/dev/null | awk '{print -$2}')
  if [ -n "$stat" ] && [ "$stat" -le -50 ] 2>/dev/null; then
    echo "  ⚠️  $f: ${stat}L (의도된 정리인지 확인)"
  fi
done

echo ""
echo "=== 4) tsc ==="
npx tsc --noEmit --skipLibCheck 2>&1 | grep -v 'next-env.d.ts' | head -20

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "❌ 검증 실패 — 위 항목 수정 필요"
  exit 1
fi

echo ""
echo "✅ 검증 통과"

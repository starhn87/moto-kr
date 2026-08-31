// 동기화 전후의 검토 목록을 비교해 이번 실행에서 새로 생기거나 바뀐 항목만 추린다.
// 사용: node scripts/find-new-unmapped.mjs <before> <after> <output>

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const buckets = ['unmapped', 'ambiguous'];
const keyOf = (item) => `${item.bucket}\0${item.office ?? ''}\0${item.vehNm}`;

export const reviewItemsOf = (review) => buckets.flatMap((bucket) =>
  (review[bucket] ?? []).map((item) => ({ bucket, ...item })),
);

export const findNewReviewItems = (before, after) => {
  const previous = new Map(reviewItemsOf(before).map((item) => [keyOf(item), JSON.stringify(item)]));
  const reviewItems = reviewItemsOf(after);
  return {
    generatedAt: after.meta?.generatedAt ?? null,
    candidates: reviewItems.filter((item) => previous.get(keyOf(item)) !== JSON.stringify(item)),
    reviewItems,
  };
};

const main = () => {
  const [, , beforePath, afterPath, outputPath] = process.argv;
  if (!beforePath || !afterPath || !outputPath) {
    throw new Error('사용법: node scripts/find-new-unmapped.mjs <before> <after> <output>');
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const result = findNewReviewItems(before, after);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(String(result.candidates.length));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

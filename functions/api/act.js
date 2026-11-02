// 网页按钮直接改卡：POST /api/act。逻辑在 scripts/lib/act-handler.mjs，这里只接上 Cloudflare Pages。
import { handleAct } from '../../scripts/lib/act-handler.mjs';
import cardSchema from '../../schema/card.schema.json';

export function onRequest(context) {
  return handleAct(context.request, context.env || {}, { cardSchema });
}

'use strict';

const { Deliveries, VipServers, Users, Stock, Products } = require('../database/models');
const { won } = require('../util');

let botClient = null;
function setBotClient(client) {
  botClient = client;
}

async function dm(discordId, payload) {
  if (!botClient) return false;
  try {
    const user = await botClient.users.fetch(discordId);
    await user.send(payload);
    return true;
  } catch (e) {
    return false;
  }
}

// 배송 완료 처리 (오퍼레이터/외부 워커) → 유저 DM
async function completeDelivery(id, operator = '') {
  const d = Deliveries.get(id);
  if (!d) return { ok: false, error: 'NOT_FOUND' };
  if (d.status === 'completed') return { ok: false, error: 'ALREADY_DONE' };
  Deliveries.setStatus(id, 'completed', { operator });

  await dm(d.discord_id, {
    embeds: [
      {
        color: 0x57f287,
        title: '✅ 아이템 지급 완료',
        description: `**${d.product_name}** 트레이드가 완료되었습니다.`,
        fields: [
          { name: '아이템', value: d.roblox_item || d.product_name, inline: true },
          { name: '수량', value: `${d.quantity}개`, inline: true },
          { name: '로블록스', value: d.roblox_username || '-', inline: true },
        ],
        footer: { text: '이용해 주셔서 감사합니다 · MungChi Market' },
        timestamp: new Date().toISOString(),
      },
    ],
  });
  return { ok: true, delivery: Deliveries.get(id) };
}

// 배송 실패 처리 → 상태 변경 + (옵션)환불/재고복구 + 유저 DM
async function failDelivery(id, reason = '', refund = true) {
  const d = Deliveries.get(id);
  if (!d) return { ok: false, error: 'NOT_FOUND' };
  if (d.status === 'completed') return { ok: false, error: 'ALREADY_DONE' };
  Deliveries.setStatus(id, 'failed', { note: reason });

  let refunded = false;
  if (refund && d.price > 0) {
    try {
      Users.adjustBalance(d.discord_id, d.price, 'refund', `로블록스 배송 실패 환불 #${d.id}`);
      // 재고 복구 (수량만큼 재입고)
      if (d.product_id && Products.get(d.product_id)) {
        Stock.addBulk(
          d.product_id,
          Array.from({ length: d.quantity || 1 }, () => `RESTOCK-${d.id}`)
        );
      }
      refunded = true;
    } catch (e) {
      /* ignore */
    }
  }

  await dm(d.discord_id, {
    embeds: [
      {
        color: 0xed4245,
        title: '⚠️ 아이템 배송 실패',
        description:
          `**${d.product_name}** 배송을 완료하지 못했습니다.` +
          (reason ? `\n사유: ${reason}` : '') +
          (refunded ? `\n\n💰 ${won(d.price)}을 잔액으로 환불했습니다.` : ''),
        footer: { text: '문의는 관리자에게 남겨주세요 · MungChi Market' },
        timestamp: new Date().toISOString(),
      },
    ],
  });
  return { ok: true, delivery: Deliveries.get(id), refunded };
}

// 유저에게 VIP 접속 안내 재발송
async function resendLink(id) {
  const d = Deliveries.get(id);
  if (!d) return { ok: false, error: 'NOT_FOUND' };
  const server = d.vip_server_id ? VipServers.get(d.vip_server_id) : null;
  if (!server) return { ok: false, error: 'NO_SERVER' };
  await dm(d.discord_id, { embeds: [buildJoinEmbed(d, server)] });
  return { ok: true };
}

// VIP 접속 안내 임베드 (봇 플로우와 공용)
function buildJoinEmbed(delivery, server) {
  return {
    color: 0x00a2ff,
    title: '🎮 게임 아이템 수령 안내',
    description:
      `**${delivery.product_name}** 구매가 완료되었습니다!\n` +
      `아래 **VIP 서버**로 접속하시면 담당 계정이 트레이드로 아이템을 지급합니다.`,
    fields: [
      { name: '게임', value: server.game || 'Grow a Garden 2', inline: true },
      { name: '아이템', value: `${delivery.roblox_item || delivery.product_name} x${delivery.quantity}`, inline: true },
      { name: '내 로블록스', value: delivery.roblox_username || '-', inline: true },
      { name: '🔗 VIP 서버 링크', value: server.vip_link },
      { name: '🤝 트레이드 상대(꼭두각시)', value: server.puppet_name ? `\`${server.puppet_name}\`` : '접속 후 안내됩니다' },
      {
        name: '📌 진행 방법',
        value:
          '1. 위 링크로 접속\n2. 트레이드 요청을 **수락 대기** 상태로 두기\n3. `' +
          (server.puppet_name || '담당 계정') +
          '` 이(가) 트레이드를 보냅니다\n4. 아이템 확인 후 수락',
      },
    ],
    footer: { text: `배송번호 #${delivery.id} · MungChi Market` },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  setBotClient,
  dm,
  completeDelivery,
  failDelivery,
  resendLink,
  buildJoinEmbed,
};

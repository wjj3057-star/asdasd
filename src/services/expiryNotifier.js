'use strict';

// 구독 만료 자동 알림: 만료 3일 전 / 1일 전 / 만료 시점에
// 라이선스를 등록한 서버 관리자(manager_id)에게 DM 발송.
// notify_stage 로 단계별 1회만 발송하며, 재인증(/인증) 시 단계가 초기화된다.

const config = require('../config');
const { Guilds } = require('../database/models');

let botClient = null;
function setBotClient(client) {
  botClient = client;
}

const DAY = 24 * 60 * 60 * 1000;
// 단계 순서: '' → 3d → 1d → expired (뒤로만 진행)
const STAGE_ORDER = ['', '3d', '1d', 'expired'];

function stageFor(expiresAt, nowMs) {
  const left = expiresAt - nowMs;
  if (left <= 0) return 'expired';
  if (left <= 1 * DAY) return '1d';
  if (left <= 3 * DAY) return '3d';
  return '';
}

function buildEmbed(guild, stage) {
  const ts = Math.floor(guild.expires_at / 1000);
  if (stage === 'expired') {
    return {
      color: 0xed4245,
      title: '🔴 구독이 만료되었습니다',
      description:
        `**${guild.name || guild.guild_id}** 서버의 자판기 구독이 만료되어 기능이 잠겼습니다.\n` +
        '서버에서 `/인증 <키>` 로 새 라이선스를 등록하면 즉시 다시 이용할 수 있습니다.',
      fields: [{ name: '만료 시각', value: `<t:${ts}:F>`, inline: true }],
      footer: { text: 'MungChi Market · 구독 알림' },
      timestamp: new Date().toISOString(),
    };
  }
  const dayText = stage === '1d' ? '1일' : '3일';
  return {
    color: 0xfee75c,
    title: `⏳ 구독 만료 ${dayText} 전입니다`,
    description:
      `**${guild.name || guild.guild_id}** 서버의 자판기 구독이 곧 만료됩니다.\n` +
      '만료되면 구매/충전 등 자판기 기능이 잠깁니다. 미리 `/인증 <키>` 로 연장해 주세요.',
    fields: [{ name: '만료 시각', value: `<t:${ts}:F> (<t:${ts}:R>)`, inline: true }],
    footer: { text: 'MungChi Market · 구독 알림' },
    timestamp: new Date().toISOString(),
  };
}

async function dmUser(userId, embed) {
  if (!botClient || !userId) return false;
  try {
    const user = await botClient.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch (e) {
    return false; // DM 차단 등
  }
}

// 주기 실행 본체 (테스트를 위해 nowMs 주입 가능)
async function checkOnce(nowMs = Date.now()) {
  const sent = [];
  for (const g of Guilds.withSubscription()) {
    const target = stageFor(g.expires_at, nowMs);
    if (!target) continue;
    // 이미 같은/이후 단계 알림을 보냈으면 스킵
    if (STAGE_ORDER.indexOf(g.notify_stage || '') >= STAGE_ORDER.indexOf(target)) continue;

    const embed = buildEmbed(g, target);
    let ok = await dmUser(g.manager_id, embed);
    // 관리자 DM 실패 시 소유자에게라도 통지 (운영 인지용)
    if (!ok) {
      for (const oid of config.ownerIds) {
        // eslint-disable-next-line no-await-in-loop
        if (await dmUser(oid, embed)) { ok = true; break; }
      }
    }
    Guilds.setNotifyStage(g.guild_id, target); // DM 실패해도 단계는 기록 (무한 재시도 방지)
    sent.push({ guild_id: g.guild_id, stage: target, delivered: ok });
  }
  return sent;
}

let timer = null;
function start() {
  // 30분 주기 점검 (시작 직후 1회 즉시)
  timer = setInterval(() => checkOnce().catch(() => {}), 30 * 60 * 1000);
  checkOnce().catch(() => {});
  console.log('[expiry] 구독 만료 알림 감시 시작 (30분 주기)');
}
function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { setBotClient, checkOnce, stageFor, start, stop };

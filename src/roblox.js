'use strict';

// 로블록스 공개 API 유틸 (인증 불필요, 읽기 전용)
// - 닉네임 실존 확인 / userId 조회 / 아바타 썸네일
// ※ 게임 내 트레이드 자동화는 로블록스 ToS 위반이라 포함하지 않습니다.
//   이 모듈은 "구매자가 입력한 로블록스 닉네임이 실제 계정인지" 검증하는 용도입니다.

async function resolveUsername(username) {
  const name = String(username || '').trim();
  if (!name) return { ok: false, error: 'EMPTY' };
  try {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }),
    });
    if (!res.ok) return { ok: false, error: 'API_' + res.status };
    const json = await res.json();
    const hit = (json.data || [])[0];
    if (!hit) return { ok: false, error: 'NOT_FOUND' };
    return {
      ok: true,
      id: String(hit.id),
      name: hit.name,
      displayName: hit.displayName,
    };
  } catch (e) {
    return { ok: false, error: 'NETWORK' };
  }
}

function avatarUrl(userId) {
  if (!userId) return '';
  return `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`;
}

function profileUrl(userId) {
  return userId ? `https://www.roblox.com/users/${userId}/profile` : '';
}

module.exports = { resolveUsername, avatarUrl, profileUrl };

'use strict';

const { EmbedBuilder } = require('discord.js');
const { Users, Purchases, Charges } = require('../../database/models');
const { won } = require('../../util');

// 정보 버튼: 내 잔액/입금자명/구매내역
async function showInfo(interaction) {
  const gid = interaction.guildId;
  const user = Users.ensure(gid, interaction.user.id, interaction.user.username);
  const purchases = Purchases.byUser(gid, interaction.user.id, 5);
  const pending = Charges.pendingByUser(gid, interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ 내 정보')
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: '유저', value: `<@${interaction.user.id}>`, inline: true },
      { name: '보유 잔액', value: `**${won(user.balance)}**`, inline: true },
      { name: '입금자명', value: user.deposit_name || '미설정', inline: true },
      { name: '누적 충전', value: won(user.total_charged), inline: true },
      { name: '누적 사용', value: won(user.total_spent), inline: true },
      { name: '구매 횟수', value: `${Purchases.byUser(gid, interaction.user.id, 9999).length}회`, inline: true }
    );

  if (pending.length) {
    embed.addFields({
      name: '⏳ 대기중 충전요청',
      value: pending
        .slice(0, 5)
        .map((c) =>
          c.method === 'coin'
            ? `#${c.id} 코인 ${c.coin_amount} ${c.coin_symbol} (${won(c.amount)})`
            : `#${c.id} 계좌 ${won(c.expected_amount)} (${won(c.amount)})`
        )
        .join('\n'),
    });
  }

  if (purchases.length) {
    embed.addFields({
      name: '🧾 최근 구매내역',
      value: purchases
        .map((p) => `• ${p.product_name} · ${won(p.price)} · <t:${Math.floor(p.created_at / 1000)}:R>`)
        .join('\n')
        .slice(0, 1000),
    });
  } else {
    embed.addFields({ name: '🧾 최근 구매내역', value: '구매 내역이 없습니다.' });
  }

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { showInfo };

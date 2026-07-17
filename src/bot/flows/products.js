'use strict';

const { EmbedBuilder } = require('discord.js');
const { Categories, Products } = require('../../database/models');
const { won } = require('../../util');

// 제품 버튼: 전체 카테고리/제품/재고 현황 (읽기 전용)
async function showProducts(interaction) {
  const cats = Categories.all();
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('🔎 전체 제품 목록');

  if (!cats.length) {
    embed.setDescription('등록된 제품이 없습니다.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  let anyProduct = false;
  for (const c of cats) {
    const products = Products.byCategory(c.id);
    if (!products.length) continue;
    anyProduct = true;
    const lines = products
      .map((p) => {
        const stock = Products.stockCount(p.id);
        const soldOut = stock < 1 ? ' `품절`' : ` · 재고 ${stock}개`;
        return `• ${p.emoji ? p.emoji + ' ' : ''}${p.name} — ${won(p.price)}${soldOut}`;
      })
      .join('\n');
    embed.addFields({
      name: `${c.emoji ? c.emoji + ' ' : ''}${c.name}`,
      value: lines.slice(0, 1024),
    });
  }

  if (!anyProduct) embed.setDescription('판매중인 제품이 없습니다.');
  else embed.setDescription('구매하려면 **구매** 버튼을 눌러주세요.');

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { showProducts };

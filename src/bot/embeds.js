'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getAllSettings } = require('../database/models');
const IDS = require('./ids');

function parseColor(hex) {
  if (!hex) return 0x57f287;
  const n = parseInt(String(hex).replace('#', ''), 16);
  return Number.isNaN(n) ? 0x57f287 : n;
}

// 자판기 메인 패널 임베드 + 4버튼 (사진 1 구성)
function buildPanel() {
  const s = getAllSettings();
  const embed = new EmbedBuilder()
    .setColor(parseColor(s.embed_color))
    .setTitle(s.shop_name || 'Market')
    .setDescription(s.shop_description || '');

  if (s.embed_footer) embed.setFooter({ text: s.embed_footer });
  if (s.embed_thumbnail) embed.setThumbnail(s.embed_thumbnail);
  if (s.embed_image) embed.setImage(s.embed_image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.BTN_BUY)
      .setLabel('구매')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(IDS.BTN_PRODUCTS)
      .setLabel('제품')
      .setEmoji('🔎')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(IDS.BTN_CHARGE)
      .setLabel('충전')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDS.BTN_INFO)
      .setLabel('정보')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { buildPanel, parseColor };

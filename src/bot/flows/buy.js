'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const IDS = require('../ids');
const { Categories, Products, Stock, Users, Purchases } = require('../../database/models');
const { won } = require('../../util');

// 사진2: "구매하기 - 카테고리를 선택하면 제품 목록이 열립니다"
async function startBuy(interaction) {
  const cats = Categories.all();
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🛒 구매하기')
    .setDescription('카테고리를 선택하면 제품 목록이 열립니다.');

  if (!cats.length) {
    embed.setDescription('현재 등록된 카테고리가 없습니다. 잠시 후 다시 시도해 주세요.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(IDS.SELECT_CATEGORY)
    .setPlaceholder('카테고리 선택')
    .addOptions(
      cats.slice(0, 25).map((c) => ({
        label: c.name.slice(0, 100),
        description: (c.description || '').slice(0, 100) || undefined,
        value: String(c.id),
        emoji: c.emoji || undefined,
      }))
    );

  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  });
}

async function onCategorySelected(interaction) {
  const categoryId = parseInt(interaction.values[0], 10);
  const cat = Categories.get(categoryId);
  if (!cat) return interaction.update({ content: '카테고리를 찾을 수 없습니다.', embeds: [], components: [] });

  const products = Products.byCategory(categoryId);
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🛒 ${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}`)
    .setDescription(cat.description || '구매할 제품을 선택하세요.');

  // 카테고리 선택 메뉴는 유지, 제품 선택 메뉴 추가
  const cats = Categories.all();
  const catMenu = new StringSelectMenuBuilder()
    .setCustomId(IDS.SELECT_CATEGORY)
    .setPlaceholder(`${cat.name} (변경하려면 선택)`)
    .addOptions(
      cats.slice(0, 25).map((c) => ({
        label: c.name.slice(0, 100),
        value: String(c.id),
        emoji: c.emoji || undefined,
        default: c.id === categoryId,
      }))
    );

  const rows = [new ActionRowBuilder().addComponents(catMenu)];

  if (!products.length) {
    embed.addFields({ name: '​', value: '이 카테고리에는 판매중인 제품이 없습니다.' });
  } else {
    const prodMenu = new StringSelectMenuBuilder()
      .setCustomId(`${IDS.SELECT_PRODUCT}:${categoryId}`)
      .setPlaceholder('제품 선택')
      .addOptions(
        products.slice(0, 25).map((p) => {
          const stock = Products.stockCount(p.id);
          return {
            label: `${p.name} · ${won(p.price)}`.slice(0, 100),
            description: `재고 ${stock}개${p.description ? ' · ' + p.description : ''}`.slice(0, 100),
            value: String(p.id),
            emoji: p.emoji || undefined,
          };
        })
      );
    rows.push(new ActionRowBuilder().addComponents(prodMenu));

    embed.addFields(
      products.slice(0, 10).map((p) => ({
        name: `${p.emoji ? p.emoji + ' ' : ''}${p.name}`,
        value: `가격 ${won(p.price)} · 재고 ${Products.stockCount(p.id)}개`,
        inline: true,
      }))
    );
  }

  return interaction.update({ embeds: [embed], components: rows });
}

async function onProductSelected(interaction) {
  const productId = parseInt(interaction.values[0], 10);
  const product = Products.get(productId);
  if (!product) return interaction.update({ content: '제품을 찾을 수 없습니다.', embeds: [], components: [] });

  const stock = Products.stockCount(productId);
  const user = Users.ensure(interaction.user.id, interaction.user.username);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${product.emoji ? product.emoji + ' ' : ''}${product.name}`)
    .setDescription(product.description || '​')
    .addFields(
      { name: '가격', value: won(product.price), inline: true },
      { name: '재고', value: `${stock}개`, inline: true },
      { name: '내 잔액', value: won(user.balance), inline: true }
    );

  const buyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.BUY_QTY_MODAL}:${productId}`)
      .setLabel('수량 입력 후 구매')
      .setEmoji('🧾')
      .setStyle(ButtonStyle.Success)
      .setDisabled(stock < 1),
    new ButtonBuilder()
      .setCustomId(`${IDS.BUY_CONFIRM}:${productId}:1`)
      .setLabel('1개 즉시구매')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(stock < 1 || user.balance < product.price)
  );

  return interaction.update({ embeds: [embed], components: [buyRow] });
}

async function openQtyModal(interaction, productId) {
  const modal = new ModalBuilder()
    .setCustomId(`${IDS.BUY_CONFIRM}:modal:${productId}`)
    .setTitle('구매 수량 입력');
  const input = new TextInputBuilder()
    .setCustomId('qty')
    .setLabel('구매 수량')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('예: 2')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

// 실제 구매 처리 (버튼 즉시구매 / 수량모달 제출 공용)
async function processPurchase(interaction, productId, qty) {
  qty = Math.max(1, Math.min(50, parseInt(qty, 10) || 1));
  const product = Products.get(productId);
  if (!product) return safeReply(interaction, '제품을 찾을 수 없습니다.');

  const available = Products.stockCount(productId);
  if (available < qty)
    return safeReply(interaction, `재고가 부족합니다. (현재 재고 ${available}개)`);

  const total = product.price * qty;
  const user = Users.ensure(interaction.user.id, interaction.user.username);
  if (user.balance < total)
    return safeReply(
      interaction,
      `잔액이 부족합니다.\n필요 금액: ${won(total)} / 내 잔액: ${won(user.balance)}\n\n**충전** 버튼으로 잔액을 충전해 주세요.`
    );

  // 재고 확보 (원자적) → 잔액 차감 → 지급
  const items = [];
  for (let i = 0; i < qty; i++) {
    const item = Stock.reserveOne(productId, interaction.user.id);
    if (!item) break;
    items.push(item);
  }
  if (items.length < qty) {
    // 롤백 불가한 상황 방지: 확보한 만큼만 진행
    if (!items.length) return safeReply(interaction, '재고 확보에 실패했습니다. 다시 시도해 주세요.');
  }
  const realQty = items.length;
  const realTotal = product.price * realQty;

  try {
    Users.adjustBalance(interaction.user.id, -realTotal, 'purchase', `${product.name} x${realQty} 구매`);
  } catch (e) {
    return safeReply(interaction, '결제 처리 중 오류가 발생했습니다. (잔액 부족)');
  }

  const contents = [];
  for (const item of items) {
    Purchases.create({
      discord_id: interaction.user.id,
      product_id: product.id,
      product_name: product.name,
      stock_id: item.id,
      price: product.price,
      content: item.content,
    });
    contents.push(item.content);
  }

  const newBalance = Users.get(interaction.user.id).balance;

  // 상품 내용은 DM으로 발송
  const dmEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ 구매가 완료되었습니다')
    .setDescription(`**${product.name}** ${realQty}개`)
    .addFields(
      { name: '결제 금액', value: won(realTotal), inline: true },
      { name: '남은 잔액', value: won(newBalance), inline: true },
      { name: '상품 내용', value: contents.map((c) => `\`\`\`${c}\`\`\``).join('\n').slice(0, 1000) }
    )
    .setTimestamp();

  let dmOk = true;
  try {
    await interaction.user.send({ embeds: [dmEmbed] });
  } catch (e) {
    dmOk = false;
  }

  const resultEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ 구매 완료')
    .setDescription(
      dmOk
        ? `**${product.name}** ${realQty}개 구매가 완료되었습니다.\n상품 내용을 **DM**으로 보내드렸어요.`
        : `**${product.name}** ${realQty}개 구매가 완료되었습니다.\n⚠️ DM이 차단되어 아래에 표시합니다.`
    )
    .addFields(
      { name: '결제 금액', value: won(realTotal), inline: true },
      { name: '남은 잔액', value: won(newBalance), inline: true }
    );
  if (!dmOk) {
    resultEmbed.addFields({
      name: '상품 내용',
      value: contents.map((c) => `\`\`\`${c}\`\`\``).join('\n').slice(0, 1000),
    });
  }

  return safeReply(interaction, { embeds: [resultEmbed] });
}

async function safeReply(interaction, payload) {
  const data =
    typeof payload === 'string'
      ? { content: payload, embeds: [], components: [] }
      : { embeds: [], components: [], ...payload };
  data.ephemeral = true;
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(data);
  }
  if (interaction.isMessageComponent()) {
    return interaction.update({ ...data, ephemeral: undefined }).catch(() => interaction.followUp(data));
  }
  return interaction.reply(data);
}

module.exports = {
  startBuy,
  onCategorySelected,
  onProductSelected,
  openQtyModal,
  processPurchase,
};

'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const IDS = require('../ids');
const { Users, Deliveries, VipServers, Products } = require('../../database/models');
const { won } = require('../../util');
const roblox = require('../../roblox');
const deliveryService = require('../../roblox/deliveryService');

// 구매 직후 진입 (buy.processPurchase 에서 분기)
async function handleRobloxPurchase(interaction, { product, qty, total, newBalance, purchaseId }) {
  const user = Users.ensure(interaction.user.id, interaction.user.username);

  // 이미 로블록스 닉네임이 등록되어 있으면 바로 대기열 등록
  if (user.roblox_username) {
    const delivery = createQueuedDelivery(interaction.user.id, product, qty, total, purchaseId, {
      roblox_username: user.roblox_username,
      roblox_userid: user.roblox_userid,
    });
    await sendJoinDM(interaction.user, delivery);
    return reply(interaction, buildBuyResult(product, qty, total, newBalance, true, user.roblox_username));
  }

  // 닉네임 미등록 → 배송 세션 생성 후 DM으로 닉네임 요청
  const delivery = Deliveries.create({
    purchase_id: purchaseId,
    discord_id: interaction.user.id,
    product_id: product.id,
    product_name: product.name,
    roblox_item: product.roblox_item || product.name,
    quantity: qty,
    price: total,
    status: 'awaiting_username',
  });

  const dmEmbed = new EmbedBuilder()
    .setColor(0x00a2ff)
    .setTitle('🎮 게임 아이템 수령 - 로블록스 닉네임 등록')
    .setDescription(
      `**${product.name}** ${qty}개 구매가 완료되었습니다!\n` +
        '아이템을 받을 **로블록스 닉네임**을 등록해 주세요.\n아래 버튼을 눌러 입력하면 접속 안내를 보내드립니다.'
    )
    .setFooter({ text: `배송번호 #${delivery.id} · MungChi Market` });

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.ROBLOX_SET_USERNAME}:${delivery.id}`)
      .setLabel('로블록스 닉네임 입력')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Primary)
  );

  let dmOk = true;
  try {
    await interaction.user.send({ embeds: [dmEmbed], components: [btn] });
  } catch (e) {
    dmOk = false;
  }

  return reply(interaction, buildBuyResult(product, qty, total, newBalance, dmOk, null));
}

// 닉네임 입력 버튼 → 모달
async function openUsernameModal(interaction, deliveryId) {
  const delivery = Deliveries.get(deliveryId);
  const modal = new ModalBuilder()
    .setCustomId(`${IDS.ROBLOX_USERNAME_MODAL}:${deliveryId}`)
    .setTitle('로블록스 닉네임 입력');
  const input = new TextInputBuilder()
    .setCustomId('username')
    .setLabel('로블록스 닉네임 (아이디)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('예: Builderman')
    .setRequired(true)
    .setMaxLength(30);
  if (delivery && delivery.roblox_username) input.setValue(delivery.roblox_username);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

// 닉네임 모달 제출 → 실존 확인 → 대기열 등록 + 접속 안내
async function submitUsername(interaction, deliveryId) {
  const delivery = Deliveries.get(deliveryId);
  if (!delivery) return interaction.reply({ content: '배송 정보를 찾을 수 없습니다.', ephemeral: true });

  const raw = interaction.fields.getTextInputValue('username').trim();
  await interaction.deferReply({ ephemeral: true });

  const resolved = await roblox.resolveUsername(raw);
  if (!resolved.ok) {
    const msg =
      resolved.error === 'NOT_FOUND'
        ? `⚠️ '${raw}' 닉네임의 로블록스 계정을 찾을 수 없습니다. 정확한 닉네임을 다시 입력해 주세요.`
        : '⚠️ 로블록스 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    return interaction.editReply({ content: msg });
  }

  // 유저/배송에 로블록스 정보 저장
  Users.setRoblox(interaction.user.id, resolved.name, resolved.id);
  Deliveries.setUsername(delivery.id, resolved.name, resolved.id);

  // 대기열 등록 + 서버 배정
  const product = Products.get(delivery.product_id);
  const server = VipServers.pickForGame(product ? product.roblox_game : 'Grow a Garden 2');
  if (server) Deliveries.assignServer(delivery.id, server.id);
  Deliveries.setStatus(delivery.id, 'queued');

  const updated = Deliveries.get(delivery.id);
  await sendJoinDM(interaction.user, updated);

  return interaction.editReply({
    content:
      `✅ **${resolved.name}** (으)로 등록되었습니다.` +
      (server ? '\n접속 안내를 DM으로 보냈어요. VIP 서버로 접속해 주세요!' : '\n관리자 확인 후 접속 안내가 전송됩니다.'),
  });
}

/* ---------------- 내부 헬퍼 ---------------- */

function createQueuedDelivery(discordId, product, qty, total, purchaseId, roblox) {
  const server = VipServers.pickForGame(product.roblox_game);
  const delivery = Deliveries.create({
    purchase_id: purchaseId,
    discord_id: discordId,
    product_id: product.id,
    product_name: product.name,
    roblox_item: product.roblox_item || product.name,
    quantity: qty,
    price: total,
    roblox_username: roblox.roblox_username,
    roblox_userid: roblox.roblox_userid,
    vip_server_id: server ? server.id : null,
    status: 'queued',
  });
  return delivery;
}

async function sendJoinDM(discordUser, delivery) {
  const server = delivery.vip_server_id ? VipServers.get(delivery.vip_server_id) : null;
  try {
    if (server) {
      await discordUser.send({ embeds: [deliveryService.buildJoinEmbed(delivery, server)] });
    } else {
      await discordUser.send({
        embeds: [
          {
            color: 0xfee75c,
            title: '⏳ 배송 대기 중',
            description:
              `**${delivery.product_name}** 배송이 대기열에 등록되었습니다.\n` +
              '현재 배정 가능한 VIP 서버를 준비 중이며, 준비되는 대로 접속 링크를 보내드립니다.',
            footer: { text: `배송번호 #${delivery.id} · MungChi Market` },
          },
        ],
      });
    }
  } catch (e) {
    /* DM 차단 */
  }
}

function buildBuyResult(product, qty, total, newBalance, dmOk, robloxName) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ 구매 완료 (게임 아이템)')
    .setDescription(
      dmOk
        ? `**${product.name}** ${qty}개 구매가 완료되었습니다.\n` +
            (robloxName
              ? `등록된 로블록스 **${robloxName}** 계정으로 접속 안내를 **DM**으로 보냈어요.`
              : '로블록스 닉네임 등록 안내를 **DM**으로 보냈어요. DM을 확인해 주세요!')
        : `**${product.name}** ${qty}개 구매가 완료되었습니다.\n⚠️ DM이 차단되어 안내를 보낼 수 없습니다. DM을 열고 정보 버튼에서 다시 시도해 주세요.`
    )
    .addFields(
      { name: '결제 금액', value: won(total), inline: true },
      { name: '남은 잔액', value: won(newBalance), inline: true }
    );
  return { embeds: [embed] };
}

function reply(interaction, payload) {
  const buy = require('./buy');
  return buy.safeReply(interaction, payload);
}

module.exports = {
  handleRobloxPurchase,
  openUsernameModal,
  submitUsername,
};

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
const { getAllSettings, Users, Charges } = require('../../database/models');
const { won, makeUniqueAmount, sanitizeName, parseAmount } = require('../../util');

// 충전 방식 선택 (계좌충전 / 코인충전)
async function startCharge(interaction) {
  const s = getAllSettings();
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎁 잔액 충전')
    .setDescription('충전 방식을 선택해 주세요.\n모든 충전은 **자동 잔액충전** 시스템으로 처리됩니다.')
    .addFields(
      { name: '🏦 계좌충전', value: '무통장 입금(PG 미사용) · 입금 확인 시 자동 반영', inline: false },
      { name: '🪙 코인충전', value: `${s.coin_symbol}(${s.coin_network}) · 입금 확인 시 자동 반영`, inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.CHARGE_ACCOUNT).setLabel('계좌충전').setEmoji('🏦').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(IDS.CHARGE_COIN).setLabel('코인충전').setEmoji('🪙').setStyle(ButtonStyle.Primary)
  );

  return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// 계좌충전: 금액 입력 모달
async function openAccountModal(interaction) {
  const s = getAllSettings();
  if (!s.bank_account) {
    return interaction.reply({ content: '⚠️ 관리자가 아직 입금 계좌를 설정하지 않았습니다.', ephemeral: true });
  }
  const user = Users.ensure(interaction.user.id, interaction.user.username);

  const modal = new ModalBuilder().setCustomId(IDS.CHARGE_ACCOUNT_MODAL).setTitle('계좌충전 신청');
  const amount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(`충전 금액 (원) · 최소 ${Number(s.charge_min).toLocaleString()}원`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('예: 10000')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(amount));

  // 입금자명이 아직 없으면 함께 입력받음 (최초 1회 고정)
  if (!user.deposit_name) {
    const name = new TextInputBuilder()
      .setCustomId('deposit_name')
      .setLabel('입금자명 (최초 1회 입력 · 이후 고정)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('실제 입금 시 사용할 이름')
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(name));
  }
  return interaction.showModal(modal);
}

async function submitAccountCharge(interaction) {
  const s = getAllSettings();
  const user = Users.ensure(interaction.user.id, interaction.user.username);

  const amount = parseAmount(interaction.fields.getTextInputValue('amount'));
  const min = parseInt(s.charge_min || '1000', 10);
  if (!amount || amount < min) {
    return interaction.reply({ content: `⚠️ 최소 충전 금액은 ${won(min)} 입니다.`, ephemeral: true });
  }

  // 입금자명 확정 (최초 1회)
  let depositName = user.deposit_name;
  if (!depositName) {
    const input = sanitizeName(interaction.fields.getTextInputValue('deposit_name'));
    if (!input) return interaction.reply({ content: '입금자명을 입력해 주세요.', ephemeral: true });
    Users.setDepositName(interaction.user.id, input);
    depositName = input;
  }

  // 동일 입금자명의 대기중 요청 금액과 겹치지 않는 고유 금액 생성
  const existing = Charges.pendingByUser(interaction.user.id)
    .filter((c) => c.method === 'account')
    .map((c) => c.expected_amount);
  const expected = makeUniqueAmount(amount, existing);

  const charge = Charges.create({
    discord_id: interaction.user.id,
    method: 'account',
    amount,
    expected_amount: expected,
    depositor_name: depositName,
  });

  const expireMin = parseInt(s.charge_expire_minutes || '30', 10);
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🏦 계좌충전 신청 완료')
    .setDescription(
      '아래 계좌로 **정확한 금액**을 입금해 주세요.\n입금이 확인되면 잔액이 **자동으로 충전**됩니다.'
    )
    .addFields(
      { name: '은행', value: s.bank_name || '-', inline: true },
      { name: '예금주', value: s.bank_holder || '-', inline: true },
      { name: '계좌번호', value: `\`${s.bank_account}\``, inline: false },
      { name: '입금자명', value: `**${depositName}**`, inline: true },
      { name: '입금 금액', value: `**${won(expected)}**`, inline: true },
      { name: '충전 잔액', value: won(amount), inline: true }
    )
    .setFooter({ text: `요청번호 #${charge.id} · ${expireMin}분 내 미입금 시 자동 취소` })
    .setTimestamp();

  if (expected !== amount) {
    embed.addFields({
      name: '⚠️ 반드시 확인',
      value: `동시 입금 구분을 위해 실제 입금 금액은 **${won(expected)}** 입니다.\n(끝자리까지 정확히 입금해 주세요. 충전되는 잔액은 ${won(amount)} 입니다.)`,
    });
  }

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

// 코인충전: 금액 입력 모달
async function openCoinModal(interaction) {
  const s = getAllSettings();
  if (!s.coin_wallet) {
    return interaction.reply({ content: '⚠️ 관리자가 아직 코인 지갑을 설정하지 않았습니다.', ephemeral: true });
  }
  const modal = new ModalBuilder().setCustomId(IDS.CHARGE_COIN_MODAL).setTitle('코인충전 신청');
  const amount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(`충전 금액 (원) · 최소 ${Number(s.charge_min).toLocaleString()}원`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('예: 10000')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(amount));
  return interaction.showModal(modal);
}

async function submitCoinCharge(interaction) {
  const s = getAllSettings();
  Users.ensure(interaction.user.id, interaction.user.username);

  const amount = parseAmount(interaction.fields.getTextInputValue('amount'));
  const min = parseInt(s.charge_min || '1000', 10);
  if (!amount || amount < min) {
    return interaction.reply({ content: `⚠️ 최소 충전 금액은 ${won(min)} 입니다.`, ephemeral: true });
  }

  const rate = parseFloat(s.coin_krw_rate || '1400') || 1400;
  const baseCoin = amount / rate;
  // 고유 코인 수량 생성 (소수 6자리 랜덤 꼬리)
  const existing = Charges.pendingByUser(interaction.user.id)
    .filter((c) => c.method === 'coin')
    .map((c) => c.coin_amount);
  let coinAmountStr;
  for (let i = 0; i < 50; i++) {
    const tail = (Math.floor(Math.random() * 9000) + 1000) / 1e6; // 0.001000~0.009999
    coinAmountStr = (baseCoin + tail).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    if (!existing.includes(coinAmountStr)) break;
  }

  const charge = Charges.create({
    discord_id: interaction.user.id,
    method: 'coin',
    amount,
    expected_amount: amount,
    coin_symbol: s.coin_symbol,
    coin_amount: coinAmountStr,
    address: s.coin_wallet,
  });

  const expireMin = parseInt(s.charge_expire_minutes || '30', 10);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🪙 코인충전 신청 완료')
    .setDescription('아래 지갑으로 **정확한 수량**을 전송해 주세요.\n입금이 확인되면 잔액이 **자동으로 충전**됩니다.')
    .addFields(
      { name: '코인 / 네트워크', value: `${s.coin_symbol} (${s.coin_network})`, inline: true },
      { name: '충전 잔액', value: won(amount), inline: true },
      { name: '전송 수량', value: `**${coinAmountStr} ${s.coin_symbol}**`, inline: false },
      { name: '지갑 주소', value: `\`${s.coin_wallet}\`` }
    )
    .setFooter({ text: `요청번호 #${charge.id} · ${expireMin}분 내 미입금 시 자동 취소 · 적용환율 1${s.coin_symbol}≈${won(rate)}` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
  startCharge,
  openAccountModal,
  submitAccountCharge,
  openCoinModal,
  submitCoinCharge,
};

'use strict';

const IDS = require('./ids');
const buy = require('./flows/buy');
const charge = require('./flows/charge');
const info = require('./flows/info');
const products = require('./flows/products');
const roblox = require('./flows/roblox');
const { Guilds } = require('../database/models');

// 라이선스(구독) 게이트: 미인증 서버에서는 자판기 기능을 잠근다.
// 길드 컨텍스트가 있는 vm: 상호작용에만 적용 (DM 배송 상호작용은 통과).
function gate(interaction) {
  if (!interaction.inGuild || !interaction.inGuild()) return true;
  if (!String(interaction.customId || '').startsWith('vm:')) return true;
  if (Guilds.isActive(interaction.guildId)) return true;
  const payload = {
    content: '🔒 이 서버는 아직 **구독이 활성화되지 않았거나 만료**되었습니다.\n서버 관리자가 `/인증 <키>` 로 라이선스를 등록하면 이용할 수 있습니다.',
    ephemeral: true,
  };
  (interaction.replied || interaction.deferred
    ? interaction.followUp(payload)
    : interaction.reply(payload)
  ).catch(() => {});
  return false;
}

// 모든 상호작용을 라우팅
async function handleInteraction(interaction) {
  try {
    if (!gate(interaction)) return;
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isStringSelectMenu()) return handleSelect(interaction);
    if (interaction.isModalSubmit()) return handleModal(interaction);
  } catch (err) {
    console.error('[interaction] 오류:', err);
    replyError(interaction);
  }
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === IDS.BTN_BUY) return buy.startBuy(interaction);
  if (id === IDS.BTN_PRODUCTS) return products.showProducts(interaction);
  if (id === IDS.BTN_CHARGE) return charge.startCharge(interaction);
  if (id === IDS.BTN_INFO) return info.showInfo(interaction);

  if (id === IDS.CHARGE_ACCOUNT) return charge.openAccountModal(interaction);
  if (id === IDS.CHARGE_COIN) return charge.openCoinModal(interaction);

  // vm:buy:qtymodal:<productId>
  if (id.startsWith(IDS.BUY_QTY_MODAL + ':')) {
    const productId = parseInt(id.split(':').pop(), 10);
    return buy.openQtyModal(interaction, productId);
  }
  // vm:buy:confirm:<productId>:<qty>
  if (id.startsWith(IDS.BUY_CONFIRM + ':') && !id.includes(':modal:')) {
    const parts = id.split(':'); // vm buy confirm pid qty
    const productId = parseInt(parts[3], 10);
    const qty = parseInt(parts[4], 10) || 1;
    return buy.processPurchase(interaction, productId, qty);
  }

  // vm:rbx:setname:<deliveryId>
  if (id.startsWith(IDS.ROBLOX_SET_USERNAME + ':')) {
    const deliveryId = parseInt(id.split(':').pop(), 10);
    return roblox.openUsernameModal(interaction, deliveryId);
  }
}

async function handleSelect(interaction) {
  const id = interaction.customId;
  if (id === IDS.SELECT_COIN) return charge.onCoinSelected(interaction);
  if (id === IDS.SELECT_CATEGORY) return buy.onCategorySelected(interaction);
  if (id.startsWith(IDS.SELECT_PRODUCT)) return buy.onProductSelected(interaction);
}

async function handleModal(interaction) {
  const id = interaction.customId;
  if (id === IDS.CHARGE_ACCOUNT_MODAL) return charge.submitAccountCharge(interaction);
  // vm:charge:coin:modal:<coinId>
  if (id.startsWith(IDS.CHARGE_COIN_MODAL + ':')) {
    const coinId = parseInt(id.split(':').pop(), 10);
    return charge.submitCoinCharge(interaction, coinId);
  }
  // vm:buy:confirm:modal:<productId>
  if (id.startsWith(IDS.BUY_CONFIRM + ':modal:')) {
    const productId = parseInt(id.split(':').pop(), 10);
    const qty = interaction.fields.getTextInputValue('qty');
    return buy.processPurchase(interaction, productId, qty);
  }
  // vm:rbx:namemodal:<deliveryId>
  if (id.startsWith(IDS.ROBLOX_USERNAME_MODAL + ':')) {
    const deliveryId = parseInt(id.split(':').pop(), 10);
    return roblox.submitUsername(interaction, deliveryId);
  }
}

function replyError(interaction) {
  const payload = { content: '⚠️ 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', ephemeral: true };
  if (interaction.replied || interaction.deferred) {
    interaction.followUp(payload).catch(() => {});
  } else {
    interaction.reply(payload).catch(() => {});
  }
}

module.exports = { handleInteraction };

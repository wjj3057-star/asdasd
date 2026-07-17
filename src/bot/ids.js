'use strict';

// 상호작용 customId 상수 (충돌 방지용 prefix)
module.exports = {
  BTN_BUY: 'vm:buy',
  BTN_PRODUCTS: 'vm:products',
  BTN_CHARGE: 'vm:charge',
  BTN_INFO: 'vm:info',

  SELECT_CATEGORY: 'vm:sel:cat', // 뒤에 값으로 categoryId
  SELECT_PRODUCT: 'vm:sel:prod', // categoryId 컨텍스트

  BUY_CONFIRM: 'vm:buy:confirm', // vm:buy:confirm:<productId>:<qty>
  BUY_QTY_MODAL: 'vm:buy:qtymodal',

  CHARGE_ACCOUNT: 'vm:charge:account',
  CHARGE_COIN: 'vm:charge:coin',
  SELECT_COIN: 'vm:charge:coin:sel', // 코인 종류 선택
  CHARGE_ACCOUNT_MODAL: 'vm:charge:account:modal',
  CHARGE_COIN_MODAL: 'vm:charge:coin:modal', // 뒤에 :<coinId>
  DEPOSIT_NAME_MODAL: 'vm:deposit:modal', // vm:deposit:modal:<amount>

  INFO_HISTORY: 'vm:info:history',
};

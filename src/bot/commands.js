'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// 슬래시 커맨드 정의
const commands = [
  new SlashCommandBuilder()
    .setName('인증')
    .setDescription('라이선스 키를 등록해 이 서버에서 봇 기능을 활성화합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName('키').setDescription('15자리 라이선스 키').setRequired(true)),
  new SlashCommandBuilder()
    .setName('구독')
    .setDescription('이 서버의 구독(라이선스) 상태를 확인합니다.'),
  new SlashCommandBuilder()
    .setName('키생성')
    .setDescription('라이선스 키를 발급합니다. (봇 소유자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('요금제').setDescription('요금제 선택').setRequired(true)
        .addChoices({ name: '1개월', value: '1m' }, { name: '3개월', value: '3m' })
    )
    .addIntegerOption((o) => o.setName('수량').setDescription('발급 개수 (기본 1, 최대 20)'))
    .addStringOption((o) => o.setName('메모').setDescription('키 메모 (구매자 등)')),
  new SlashCommandBuilder()
    .setName('패널')
    .setDescription('현재 채널에 자판기 패널을 설치합니다. (관리자)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('패널갱신')
    .setDescription('설치된 자판기 패널을 최신 설정으로 갱신합니다. (관리자)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('잔액')
    .setDescription('이 서버에서의 내 잔액을 확인합니다.'),
  new SlashCommandBuilder()
    .setName('충전지급')
    .setDescription('유저에게 잔액을 수동 지급/차감합니다. (관리자)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) => o.setName('유저').setDescription('대상 유저').setRequired(true))
    .addIntegerOption((o) => o.setName('금액').setDescription('지급(+) 또는 차감(-) 금액').setRequired(true))
    .addStringOption((o) => o.setName('메모').setDescription('사유')),
].map((c) => c.toJSON());

module.exports = { commands };

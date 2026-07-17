'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// 슬래시 커맨드 정의
const commands = [
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
    .setDescription('내 잔액을 확인합니다.'),
  new SlashCommandBuilder()
    .setName('충전지급')
    .setDescription('유저에게 잔액을 수동 지급/차감합니다. (관리자)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) => o.setName('유저').setDescription('대상 유저').setRequired(true))
    .addIntegerOption((o) => o.setName('금액').setDescription('지급(+) 또는 차감(-) 금액').setRequired(true))
    .addStringOption((o) => o.setName('메모').setDescription('사유')),
].map((c) => c.toJSON());

module.exports = { commands };

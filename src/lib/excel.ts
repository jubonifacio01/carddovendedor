import ExcelJS from 'exceljs';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { save as showSaveDialog } from '@tauri-apps/plugin-dialog';
import type { DailyEntry, Profile } from '../types';
import { calculateRates, sumEntries } from './calculations';

const ptDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
};

async function saveFile(bytes: Uint8Array, fileName: string, extension: 'xlsx' | 'json', mimeType: string) {
  if (isTauri()) {
    const path = await showSaveDialog({
      title: extension === 'xlsx' ? 'Salvar relatório mensal' : 'Salvar backup',
      defaultPath: fileName,
      filters: [{ name: extension === 'xlsx' ? 'Planilha Excel' : 'Backup JSON', extensions: [extension] }],
    });
    if (!path) return false;
    await invoke('save_export_file', { path, bytes: Array.from(bytes) });
    return true;
  }

  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export async function exportMonthlyReport(profile: Profile, allEntries: DailyEntry[], month: string) {
  const entries = allEntries
    .filter((entry) => entry.date.startsWith(month))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const totals = sumEntries(entries);
  const monthlyRates = calculateRates(totals);
  const encomendas = totals.pac + totals.sedex;

  const metrics = [
    ['PAC', totals.pac, null, null],
    ['SEDEX', totals.sedex, monthlyRates.sedex, profile.targets.sedex],
    ['PREMIUM 10 E 12', totals.premium, monthlyRates.premium, profile.targets.premium],
    ['VD', totals.vd, monthlyRates.vd, profile.targets.vd],
    ['AR', totals.ar, monthlyRates.ar, profile.targets.ar],
    ['EMBALAGEM', totals.packaging, monthlyRates.packaging, profile.targets.packaging],
    ['CORREIOS CELULAR', totals.cellular, null, null],
  ] as const;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Card do Vendedor';
  workbook.subject = 'Consolidado mensal de serviços e produtos';
  workbook.title = `Card do Vendedor - ${month}`;
  workbook.company = 'Card do Vendedor';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('Relatório Mensal', {
    views: [{ state: 'frozen', ySplit: 17 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  sheet.columns = [
    { header: 'Data', key: 'date', width: 13 },
    { header: 'Dia', key: 'weekday', width: 14 },
    { header: 'PAC', key: 'pac', width: 10 },
    { header: 'SEDEX', key: 'sedex', width: 10 },
    { header: 'SEDEX %', key: 'sedexRate', width: 12 },
    { header: 'Premium 10 e 12', key: 'premium', width: 18 },
    { header: 'Premium %', key: 'premiumRate', width: 13 },
    { header: 'VD', key: 'vd', width: 10 },
    { header: 'VD %', key: 'vdRate', width: 11 },
    { header: 'AR', key: 'ar', width: 10 },
    { header: 'AR %', key: 'arRate', width: 11 },
    { header: 'Embalagem', key: 'packaging', width: 14 },
    { header: 'Embalagem %', key: 'packagingRate', width: 15 },
    { header: 'Correios Celular', key: 'cellular', width: 18 },
  ];

  sheet.mergeCells('A1:N1');
  sheet.getCell('A1').value = 'CARD DO VENDEDOR | RELATÓRIO MENSAL';
  sheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B57' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 34;

  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value = `Atendente: ${profile.name}    |    Agência: ${profile.agency || 'Não informada'}    |    Referência: ${month}`;
  sheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF475569' } };
  sheet.getCell('A2').alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 23;

  sheet.mergeCells('A4:E4');
  sheet.getCell('A4').value = 'RESUMO DO MÊS';
  sheet.getCell('A4').font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF285B78' } };
  sheet.getCell('A4').alignment = { vertical: 'middle' };
  sheet.mergeCells('G4:N4');
  sheet.getCell('G4').value = 'TOTAIS E INDICADORES';
  sheet.getCell('G4').font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('G4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF285B78' } };

  sheet.getCell('A5').value = 'Dias lançados';
  sheet.getCell('B5').value = entries.length;
  sheet.getCell('C5').value = 'Encomendas (PAC + SEDEX)';
  sheet.getCell('D5').value = encomendas;
  sheet.getCell('E5').value = 'Correios Celular';
  sheet.getCell('F5').value = totals.cellular;
  sheet.getCell('G5').value = 'PAC';
  sheet.getCell('H5').value = totals.pac;
  sheet.getCell('I5').value = 'SEDEX';
  sheet.getCell('J5').value = totals.sedex;
  sheet.getCell('K5').value = 'Premium';
  sheet.getCell('L5').value = totals.premium;
  sheet.getCell('M5').value = 'VD + AR + Emb.';
  sheet.getCell('N5').value = totals.vd + totals.ar + totals.packaging;
  sheet.getRow(5).height = 28;
  for (let col = 1; col <= 14; col += 1) {
    const cell = sheet.getRow(5).getCell(col);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col % 2 ? 'FFF1F5F9' : 'FFE7EEF4' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.font = { name: 'Aptos', size: 9, bold: col % 2 === 0, color: { argb: 'FF233547' } };
  }

  sheet.getRow(7).values = ['Indicador', 'Quantidade no mês', 'Percentual mensal', 'Meta do modelo', 'Situação', 'Observação'];
  sheet.getRow(7).height = 25;
  const summaryRows = metrics.map(([label, quantity, actual, target]) => {
    const status = actual === null || target === null
      ? 'Quantidade'
      : actual >= target ? 'Meta atingida' : 'Abaixo da meta';
    const observation = label === 'SEDEX'
      ? 'Base: PAC + SEDEX'
      : actual === null ? 'Indicador de quantidade' : 'Base: PAC + SEDEX + Premium';
    return [label, quantity, actual === null ? '—' : actual, target === null ? '—' : target, status, observation];
  });
  summaryRows.forEach((row, index) => {
    const excelRow = 8 + index;
    sheet.getRow(excelRow).values = row;
    sheet.getCell(`C${excelRow}`).numFmt = '0.00%';
    sheet.getCell(`D${excelRow}`).numFmt = '0.00%';
    for (let col = 1; col <= 6; col += 1) {
      const cell = sheet.getRow(excelRow).getCell(col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF7F9FB' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    }
  });
  sheet.getRow(7).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF173B57' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EFF5' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 17;
  sheet.getColumn(4).width = 16;
  sheet.getColumn(5).width = 16;
  sheet.getColumn(6).width = 28;

  const detailStart = 17;
  sheet.mergeCells(`A${detailStart - 1}:N${detailStart - 1}`);
  sheet.getCell(`A${detailStart - 1}`).value = 'LANÇAMENTOS DIÁRIOS';
  sheet.getCell(`A${detailStart - 1}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(`A${detailStart - 1}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF285B78' } };
  sheet.getRow(detailStart).values = sheet.columns.map((column) => column.header as string);
  sheet.getRow(detailStart).height = 30;
  sheet.getRow(detailStart).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B57' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  entries.forEach((entry, index) => {
    const rowNumber = detailStart + index + 1;
    const rates = calculateRates(entry);
    const date = ptDate(entry.date);
    sheet.getRow(rowNumber).values = [
      date,
      new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(date),
      entry.pac,
      entry.sedex,
      rates.sedex,
      entry.premium,
      rates.premium,
      entry.vd,
      rates.vd,
      entry.ar,
      rates.ar,
      entry.packaging,
      rates.packaging,
      entry.cellular,
    ];
    sheet.getCell(`A${rowNumber}`).numFmt = 'dd/mm/yyyy';
    ['E', 'G', 'I', 'K', 'M'].forEach((col) => { sheet.getCell(`${col}${rowNumber}`).numFmt = '0.00%'; });
    sheet.getRow(rowNumber).eachCell((cell) => {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FB' } };
    });
  });

  const totalsRow = detailStart + entries.length + 1;
  sheet.getCell(`A${totalsRow}`).value = 'TOTAL DO MÊS';
  sheet.getCell(`C${totalsRow}`).value = totals.pac;
  sheet.getCell(`D${totalsRow}`).value = totals.sedex;
  sheet.getCell(`E${totalsRow}`).value = monthlyRates.sedex;
  sheet.getCell(`F${totalsRow}`).value = totals.premium;
  sheet.getCell(`G${totalsRow}`).value = monthlyRates.premium;
  sheet.getCell(`H${totalsRow}`).value = totals.vd;
  sheet.getCell(`I${totalsRow}`).value = monthlyRates.vd;
  sheet.getCell(`J${totalsRow}`).value = totals.ar;
  sheet.getCell(`K${totalsRow}`).value = monthlyRates.ar;
  sheet.getCell(`L${totalsRow}`).value = totals.packaging;
  sheet.getCell(`M${totalsRow}`).value = monthlyRates.packaging;
  sheet.getCell(`N${totalsRow}`).value = totals.cellular;
  sheet.getCell(`A${totalsRow}`).font = { bold: true };
  sheet.getRow(totalsRow).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF173B57' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EFF5' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ['E', 'G', 'I', 'K', 'M'].forEach((col) => { sheet.getCell(`${col}${totalsRow}`).numFmt = '0.00%'; });
  sheet.autoFilter = { from: `A${detailStart}`, to: `N${detailStart + Math.max(entries.length, 1)}` };
  sheet.getColumn(1).numFmt = 'dd/mm/yyyy';
  sheet.eachRow((row) => { row.font = { ...row.font, name: 'Aptos' }; });

  const safeName = profile.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fileName = `Card-do-Vendedor-${month}-${safeName || 'Atendente'}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  return saveFile(
    new Uint8Array(buffer as ArrayBuffer),
    fileName,
    'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

export async function exportBackup(state: { profile: Profile | null; entries: DailyEntry[] }) {
  const backup = {
    app: 'Card do Vendedor',
    backupVersion: 1,
    createdAt: new Date().toISOString(),
    ...state,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(backup, null, 2));
  return saveFile(
    bytes,
    `Backup-Card-do-Vendedor-${new Date().toISOString().slice(0, 10)}.json`,
    'json',
    'application/json;charset=utf-8',
  );
}

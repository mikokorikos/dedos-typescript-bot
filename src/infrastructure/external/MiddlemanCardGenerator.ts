// ============================================================================
// RUTA: src/infrastructure/external/MiddlemanCardGenerator.ts
// ============================================================================

import { createCanvas, loadImage, SKRSContext2D } from '@napi-rs/canvas'; 
import { MiddlemanCardConfig, addAlphaToHex, normalizeHex } from '@/domain/value-objects/MiddlemanCardConfig'; 
  
export async function generateMiddlemanCard(config: MiddlemanCardConfig): Promise<Buffer> { 
  const width = 800; 
  const height = 400; 
  const canvas = createCanvas(width, height); 
  const ctx = canvas.getContext('2d') as any; // permite usar filter/globalAlpha 
  
  // --- Fondo degradado --- 
  const gradient = ctx.createLinearGradient(0, 0, width, height); 
  gradient.addColorStop(0, config.gradientStart ?? '#161129'); 
  gradient.addColorStop(1, config.gradientEnd ?? '#221B41'); 
  ctx.fillStyle = gradient; 
  ctx.fillRect(0, 0, width, height); 
  
  // --- Avatar --- 
  const avatarUrl = config.avatarUrl ?? 'https://cdn.discordapp.com/embed/avatars/0.png'; 
  const avatarImg = await loadImage(avatarUrl); 
  const avatarSize = 128; 
  const avatarX = width / 2 - avatarSize / 2; 
  const avatarY = 40; 
  
  ctx.save(); 
  ctx.beginPath(); 
  ctx.arc(width / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2); 
  ctx.closePath(); 
  ctx.clip(); 
  ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize); 
  ctx.restore(); 
  
  // --- Glow y filtro (con tipado correcto) --- 
  ctx.filter = 'blur(16px)'; 
  ctx.globalAlpha = 0.6; 
  ctx.fillStyle = addAlphaToHex(config.accent ?? '#7C5CFF', 0.5); 
  ctx.beginPath(); 
  ctx.arc(width / 2, avatarY + avatarSize / 2, avatarSize / 1.8, 0, Math.PI * 2); 
  ctx.fill(); 
  ctx.globalAlpha = 1; 
  ctx.filter = 'none'; 
  
  // --- Texto principal --- 
  ctx.fillStyle = config.accentSoft ?? '#FFFFFF'; 
  ctx.font = 'bold 36px "Segoe UI", sans-serif'; 
  ctx.textAlign = 'center'; 
  ctx.fillText('Dedos Middleman', width / 2, height - 60); 
  
  return canvas.toBuffer('image/png'); 
}

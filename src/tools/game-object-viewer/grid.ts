export const drawGrid = ({
  ctx,
  reach,
  scale,
}: {
  ctx: CanvasRenderingContext2D;
  reach: number;
  scale: number;
}) => {
  const step = 10 ** Math.ceil(Math.log10(18 / scale));
  const end = Math.ceil(reach / step) * step;

  ctx.save();
  ctx.lineWidth = 1 / scale;
  ctx.font = `${0.75 / scale}rem ui-monospace, monospace`;

  for (let at = -end; at <= end; at += step) {
    if (!at) continue;
    const major = Math.round(at / step) % 5 === 0;

    ctx.strokeStyle = major ? '#435' : '#324';
    ctx.beginPath();
    ctx.moveTo(at, -end);
    ctx.lineTo(at, end);
    ctx.moveTo(-end, at);
    ctx.lineTo(end, at);
    ctx.stroke();

    if (major) {
      ctx.fillStyle = '#a9b';
      ctx.fillText(String(at), at + 4 / scale, 14 / scale);
      ctx.fillText(String(at), 4 / scale, at - 4 / scale);
    }
  }

  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = '#f9b';
  ctx.beginPath();
  ctx.moveTo(-end, 0);
  ctx.lineTo(end, 0);
  ctx.stroke();
  ctx.strokeStyle = '#7cc';
  ctx.beginPath();
  ctx.moveTo(0, -end);
  ctx.lineTo(0, end);
  ctx.stroke();
  ctx.fillStyle = '#eef';
  ctx.beginPath();
  ctx.arc(0, 0, 3 / scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText('(0, 0)', 7 / scale, -7 / scale);
  ctx.restore();
};

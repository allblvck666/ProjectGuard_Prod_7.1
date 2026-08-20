// frontend/src/pg/ProtectionCard.jsx
// Компактная карточка защиты: партнёр · клиент · артикул · метраж ·
// менеджер · бейдж · остаток дней. Одна и та же на главной и в списке.

import { Badge, Card, Icon, Track } from "./ui";
import {
  daysLeftText, fmtArea, fmtDateShort, remainingPercent, shortName,
  skuShort, statusBadge, statusKind, trackTone,
} from "./format";
import "./protection-card.css";

export default function ProtectionCard({ item, onOpen }) {
  const badge = statusBadge(item);
  const kind = statusKind(item);

  return (
    <Card status={kind} tappable onClick={() => onOpen(item)} className="pgl-card">
      <div className="pgl-card__top">
        <div className="pgl-card__partner">{item.partner || "—"}</div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <div className="pgl-card__client">{item.client || "Клиент не указан"}</div>

      <div className="pgl-card__meta">
        <span className="pgl-card__m">
          <Icon name="package" size={14} />
          {skuShort(item.sku)}
        </span>
        <span className="pgl-card__m pg-num">
          <Icon name="ruler" size={14} />
          {fmtArea(item.area_m2)}
        </span>
        <span className="pgl-card__m">
          <Icon name="user" size={14} />
          {shortName(item.manager)}
        </span>
      </div>

      <div className="pgl-card__foot">
        <Track value={remainingPercent(item)} tone={trackTone(item)} />
        <span className="pgl-card__days pg-num">
          {daysLeftText(item)} · до {fmtDateShort(item.expires_at)}
        </span>
      </div>
    </Card>
  );
}

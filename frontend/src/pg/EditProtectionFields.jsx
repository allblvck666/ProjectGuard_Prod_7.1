import { Field, Input, Select, Textarea } from "./ui";
import { managerName } from "./format";

export default function EditProtectionFields({ details, setDetails, managers, item, isAdmin }) {
  if (!details) return null;
  const set = (field) => (event) => setDetails((current) => ({ ...current, [field]: event.target.value }));
  const names = [...new Set([details.manager, ...(managers || []).map(managerName)].filter(Boolean))];
  return <div className="pgf-group">
    <Field label="Менеджер" required><Select value={details.manager} onChange={set("manager")}><option value="">Выберите менеджера…</option>{names.map((name) => <option key={name} value={name}>{name}</option>)}</Select></Field>
    <Field label="Партнёр (дилер)"><Input value={details.partner} onChange={set("partner")} /></Field>
    <Field label="Город партнёра"><Input value={details.partner_city} onChange={set("partner_city")} /></Field>
    <Field label="Клиент"><Input value={details.client} onChange={set("client")} /></Field>
    <Field label="Последние 4 цифры телефона"><Input inputMode="numeric" maxLength={4} value={details.last4} onChange={(event) => setDetails((current) => ({ ...current, last4: event.target.value.replace(/\D/g, "").slice(0, 4) }))} /></Field>
    <Field label="Город объекта"><Input value={details.object_city} onChange={set("object_city")} /></Field>
    <Field label="Адрес объекта"><Textarea value={details.address} onChange={set("address")} /></Field>
    {isAdmin && item?.status === "active" && <Field label="Срок защиты" hint="Изменяйте только для переноса срока. Правка попадёт в историю."><Input type="datetime-local" value={details.expires_at} onChange={set("expires_at")} /></Field>}
    {item?.status !== "active" && <>
      <Field label="Причина закрытия"><Textarea value={details.close_reason} onChange={set("close_reason")} /></Field>
      <Field label="Документ 1С" hint="Изменение номера не меняет статус защиты."><Input value={details.success_doc} onChange={set("success_doc")} /></Field>
    </>}
    <div className="pg-sheet__text">Изменения сохранятся в истории этой защиты. Редактирование данных само по себе не продлевает срок.</div>
  </div>;
}

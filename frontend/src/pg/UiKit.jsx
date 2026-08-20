// frontend/src/pg/UiKit.jsx
// ============================================================
// Витрина дизайн-системы (Этап 1). Открывается флагом ?ui-kit=1,
// в обычную навигацию не входит и на прод-экраны не влияет.
// ============================================================

import { useState } from "react";
import {
  Badge, Button, Card, CardSkeleton, EmptyState, ErrorState, Field,
  Icon, Input, KV, Segment, Select, Sheet, Skeleton, Textarea, Track,
} from "./ui";
import { ICON_NAMES } from "./icons";
import { setFlag } from "./flags";
import { applyPgTheme, resolvePgTheme } from "./theme";
import "./uikit.css";

function Section({ title, children }) {
  return (
    <section className="pgk-sect">
      <div className="pgk-sect__h">{title}</div>
      <div className="pgk-sect__b">{children}</div>
    </section>
  );
}

export default function UiKit({ onClose }) {
  const [theme, setTheme] = useState(resolvePgTheme);
  const [seg, setSeg] = useState("my");
  const [sheet, setSheet] = useState(false);
  const [text, setText] = useState("");
  const [bad, setBad] = useState("12");

  const switchTheme = (next) => {
    setTheme(next);
    applyPgTheme(next);
  };

  return (
    <div className="pgk">
      <header className="pgk__top">
        <div>
          <div className="pgk__title">Дизайн-система ProjectGuard</div>
          <div className="pgk__sub">Этап 1 · токены, темы, компоненты, состояния, иконки</div>
        </div>
        <Button variant="ghost" size="sm" icon="close" onClick={onClose}>Закрыть</Button>
      </header>

      <Section title="Тема">
        <Segment
          value={theme}
          onChange={switchTheme}
          options={[
            { value: "dark", label: "Тёмная", icon: "moon" },
            { value: "light", label: "Светлая", icon: "sun" },
          ]}
        />
        <div className="pgk__note">
          В Mini App тему выбирает Telegram (themeParams / colorScheme), здесь — руками, для проверки обеих палитр.
        </div>
      </Section>

      <Section title="Кнопки">
        <div className="pgk-row">
          <Button variant="primary" icon="plus">Создать</Button>
          <Button variant="secondary" icon="refresh">Обновить</Button>
          <Button variant="ghost" icon="edit">Изменить</Button>
        </div>
        <div className="pgk-row">
          <Button variant="danger" icon="trash">Удалить</Button>
          <Button variant="danger-soft" icon="ban">Пропустить</Button>
          <Button variant="secondary" loading>Сохраняем</Button>
          <Button variant="secondary" disabled>Недоступно</Button>
        </div>
        <div className="pgk-row">
          <Button variant="secondary" size="sm" icon="filter">Фильтр</Button>
          <Button variant="ghost" size="sm" icon="download">XLSX</Button>
        </div>
        <Button variant="primary" block icon="shieldCheck">Кнопка на всю ширину</Button>
      </Section>

      <Section title="Карточка и акцент статуса">
        <div className="pgk-cards">
          {[
            ["active", "Активна", "success", 80],
            ["expiring", "Истекает", "warning", 20],
            ["success", "Успешно · 1С", "accent", 100],
            ["closed", "Закрыта", "danger", 0],
          ].map(([status, label, tone, pct]) => (
            <Card key={status} status={status} tappable onClick={() => {}}>
              <div className="pgk-card__top">
                <b>ООО «Паркет-Центр»</b>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <div className="pgk-card__sub">ЖК «Северный», кв. 214</div>
              <div className="pgk-card__meta">
                <span><Icon name="package" size={14} /> AF3510QV</span>
                <span className="pg-num"><Icon name="ruler" size={14} /> 320 м²</span>
                <span><Icon name="user" size={14} /> Дмитрий</span>
              </div>
              <div className="pgk-card__foot">
                <Track value={pct} tone={pct <= 25 ? "danger" : pct <= 40 ? "warning" : undefined} />
                <span className="pg-num pgk-card__days">12 дн.</span>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Бейджи">
        <div className="pgk-row">
          <Badge tone="success">Активна</Badge>
          <Badge tone="warning">Истекает</Badge>
          <Badge tone="danger">Закрыта</Badge>
          <Badge tone="accent">Успешно · 1С</Badge>
          <Badge plain className="pg-num">Продлений 1/2</Badge>
        </div>
      </Section>

      <Section title="Поля">
        <Field label="Партнёр (дилер)" required>
          <Input placeholder="Кого защищаем" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Последние 4 цифры телефона" required hint="Нужны для проверки на дубликат">
          <Input numeric inputMode="numeric" maxLength={4} placeholder="0000" />
        </Field>
        <Field label="Менеджер" required>
          <Select defaultValue="d">
            <option value="d">Дмитрий Журавлев</option>
            <option value="a">Анна</option>
            <option value="i">Игорь</option>
          </Select>
        </Field>
        <Field label="Метраж (м²)" required error={Number(bad) < 50 ? "Защита ставится от 50 м²" : null}>
          <Input numeric inputMode="numeric" value={bad} onChange={(e) => setBad(e.target.value)} />
        </Field>
        <Field label="Комментарий">
          <Textarea placeholder="Необязательно" />
        </Field>
      </Section>

      <Section title="Сегмент-контрол">
        <Segment
          value={seg}
          onChange={setSeg}
          options={[
            { value: "my", label: "Мои" },
            { value: "all", label: "Все" },
          ]}
        />
      </Section>

      <Section title="Строки «ключ — значение»">
        <Card>
          <KV k="Артикул">AF3510QV</KV>
          <KV k="Метраж" numeric>320 м²</KV>
          <KV k="Телефон клиента" numeric>•••• 7143</KV>
          <KV k="Менеджер">Дмитрий</KV>
        </Card>
      </Section>

      <Section title="Боттом-шит">
        <Button variant="secondary" icon="trash" onClick={() => setSheet(true)}>
          Показать подтверждение
        </Button>
        <Sheet
          open={sheet}
          title="Удалить защиту?"
          onClose={() => setSheet(false)}
          actions={
            <>
              <Button variant="danger" block onClick={() => setSheet(false)}>Удалить</Button>
              <Button variant="ghost" block onClick={() => setSheet(false)}>Отмена</Button>
            </>
          }
        >
          <div className="pg-sheet__text">
            Защита ООО «Паркет-Центр» на 320 м² уйдёт в архив. Восстановить сможет только суперадмин.
          </div>
        </Sheet>
      </Section>

      <Section title="Состояния">
        <div className="pgk-states">
          <div>
            <div className="pgk-states__h">Загрузка</div>
            <CardSkeleton />
            <div style={{ marginTop: 9 }}><CardSkeleton /></div>
          </div>
          <div>
            <div className="pgk-states__h">Пусто</div>
            <EmptyState
              title="Защит пока нет"
              text="Создайте первую защиту — она появится в этом списке."
              action={<Button variant="primary" size="sm" icon="plus">Создать защиту</Button>}
            />
          </div>
          <div>
            <div className="pgk-states__h">Ошибка</div>
            <ErrorState text="Нет связи с сервером. Проверьте интернет." onRetry={() => {}} />
          </div>
        </div>
      </Section>

      <Section title="Скелетоны">
        <Skeleton height={20} width="70%" />
        <Skeleton height={12} width="45%" style={{ marginTop: 8 }} />
      </Section>

      <Section title={`Иконки · ${ICON_NAMES.length}`}>
        <div className="pgk-icons">
          {ICON_NAMES.map((name) => (
            <div className="pgk-icons__i" key={name}>
              <Icon name={name} size={20} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="pgk__foot">
        <Button
          variant="secondary"
          block
          icon="arrowLeft"
          onClick={() => {
            setFlag("ui-kit", "off");
            onClose?.();
          }}
        >
          Вернуться в приложение
        </Button>
      </div>
    </div>
  );
}

// frontend/src/pg/ActionSheets.jsx
// ============================================================
// Подтверждения и формы действий над защитой в новом оформлении.
// Состояние и обработчики те же, что у старых экранов, — компонент
// только рисует. Рендерится один раз на экране (список или карточка).
// ============================================================

import { Button, Field, Icon, Input, Segment, Sheet, Textarea } from "./ui";
import SkuPicker from "./SkuPicker";
import "./form.css";

const emptyClose = { open: false, id: null, reason: "" };
const emptySuccess = { open: false, id: null, doc: "" };
const emptyDelete = { open: false, id: null, reason: "" };
const emptyExtend = { open: false, id: null, reason: "", days: 10, message: "" };
const emptyUpdateClosed = {
  open: false, id: null, close_reason: "", success_doc: "", mode: "reason",
};

const MIN_AREA = 50;

// Те же правила, что проверяет submitEdit и бэкенд, — показываем их
// до нажатия, а не после
function editProblem({ selected, perSkuMode, unified }) {
  if (!selected || selected.length === 0) return "Добавьте хотя бы один артикул";
  const total = perSkuMode
    ? selected.reduce((sum, s) => sum + Number(s.area || 0), 0)
    : Number(unified || 0);
  if (perSkuMode && selected.some((s) => !Number(s.area))) {
    return "Укажите метраж для каждого артикула";
  }
  if (!total) return "Укажите метраж";
  if (total < MIN_AREA) return `Защита ставится от ${MIN_AREA} м²`;
  return null;
}

export default function ActionSheets({
  closeModal, setCloseModal, doClose,
  successModal, setSuccessModal, doSuccess,
  deleteModal, setDeleteModal, doDelete,
  extendRequestModal, setExtendRequestModal, submitExtendRequest,
  editModal, setEditModal, editSelectedSkus, setEditSelectedSkus,
  editPerSkuMode, setEditPerSkuMode, editAreaUnified, setEditAreaUnified,
  editComment, setEditComment, submitEdit, skus, onAreaChange,
  updateClosedModal, setUpdateClosedModal, updateClosedProtection,
}) {
  // Метраж по артикулам правим в editSelectedSkus: общий onAreaChange из App
  // пишет в состояние формы создания, поэтому поле в шите не заполнялось
  const setEditArea = (skuObj, value) =>
    setEditSelectedSkus((prev) =>
      (prev || []).map((s) =>
        s.sku === skuObj.sku && s.type === skuObj.type
          ? { ...s, area: String(value).replace(",", ".") }
          : s
      )
    );

  const editIssue = editModal?.open
    ? editProblem({
        selected: editSelectedSkus,
        perSkuMode: editPerSkuMode,
        unified: editAreaUnified,
      })
    : null;

  return (
    <>
      {/* ---- закрытие ---- */}
      <Sheet
        open={!!closeModal?.open}
        title="Закрыть защиту"
        onClose={() => setCloseModal(emptyClose)}
        actions={
          <>
            <Button
              variant="primary"
              block
              disabled={!String(closeModal?.reason || "").trim()}
              onClick={doClose}
            >
              Закрыть защиту
            </Button>
            <Button variant="ghost" block onClick={() => setCloseModal(emptyClose)}>Отмена</Button>
          </>
        }
      >
        <Field label="Причина закрытия" required hint="Попадёт в историю защиты">
          <Input
            placeholder="Например: клиент выбрал другого поставщика"
            value={closeModal?.reason || ""}
            onChange={(e) => setCloseModal({ ...closeModal, reason: e.target.value })}
          />
        </Field>
      </Sheet>

      {/* ---- успешно ---- */}
      <Sheet
        open={!!successModal?.open}
        title="Отметить как успешную"
        onClose={() => setSuccessModal(emptySuccess)}
        actions={
          <>
            <Button
              variant="primary"
              block
              disabled={!String(successModal?.doc || "").trim()}
              onClick={doSuccess}
            >
              Подтвердить
            </Button>
            <Button variant="ghost" block onClick={() => setSuccessModal(emptySuccess)}>Отмена</Button>
          </>
        }
      >
        <Field label="Документ 1С" required hint="Без номера 1С защиту закрыть нельзя">
          <Input
            placeholder="Номер документа"
            value={successModal?.doc || ""}
            onChange={(e) => setSuccessModal({ ...successModal, doc: e.target.value })}
          />
        </Field>
      </Sheet>

      {/* ---- удаление ---- */}
      <Sheet
        open={!!deleteModal?.open}
        title="Удалить защиту?"
        onClose={() => setDeleteModal(emptyDelete)}
        actions={
          <>
            <Button variant="danger" block onClick={doDelete}>Удалить</Button>
            <Button variant="ghost" block onClick={() => setDeleteModal(emptyDelete)}>Отмена</Button>
          </>
        }
      >
        <div className="pg-sheet__text">
          Защита уйдёт в архив. Восстановить её сможет только суперадмин.
        </div>
        <Field label="Причина удаления" hint="Попадёт в историю защиты">
          <Input
            placeholder="Например: дубль, создано по ошибке"
            value={deleteModal?.reason || ""}
            onChange={(e) => setDeleteModal({ ...deleteModal, reason: e.target.value })}
          />
        </Field>
      </Sheet>

      {/* ---- запрос на продление сверх лимита ---- */}
      <Sheet
        open={!!extendRequestModal?.open}
        title="Запрос на продление"
        onClose={() => setExtendRequestModal(emptyExtend)}
        actions={
          <>
            <Button
              variant="primary"
              block
              icon="send"
              disabled={!String(extendRequestModal?.reason || "").trim()}
              onClick={submitExtendRequest}
            >
              Отправить админу
            </Button>
            <Button variant="ghost" block onClick={() => setExtendRequestModal(emptyExtend)}>
              Отмена
            </Button>
          </>
        }
      >
        {extendRequestModal?.message && (
          <div className="pg-sheet__text">{extendRequestModal.message}</div>
        )}
        <Field label="Причина продления" required>
          <Textarea
            placeholder="Клиент ждёт оплату, перенос поставки и т.п."
            value={extendRequestModal?.reason || ""}
            onChange={(e) =>
              setExtendRequestModal({ ...extendRequestModal, reason: e.target.value })
            }
          />
        </Field>
      </Sheet>

      {/* ---- редактирование ---- */}
      <Sheet
        open={!!editModal?.open}
        title="Редактировать защиту"
        onClose={() => setEditModal({ open: false, id: null })}
        actions={
          <>
            {editIssue && (
              <div className="pgf-warn">
                <Icon name="alert" size={14} />
                {editIssue}
              </div>
            )}
            <Button
              variant="primary"
              block
              icon="check"
              disabled={!!editIssue}
              onClick={submitEdit}
            >
              Сохранить
            </Button>
            <Button variant="ghost" block onClick={() => setEditModal({ open: false, id: null })}>
              Отмена
            </Button>
          </>
        }
      >
        <div className="pgf-group">
          <Segment
            value={editPerSkuMode ? "per" : "one"}
            onChange={(v) => setEditPerSkuMode(v === "per")}
            options={[
              { value: "one", label: "Единый метраж" },
              { value: "per", label: "По артикулам" },
            ]}
          />

          <Field as="div" label="Артикулы" required>
            <SkuPicker
              skus={skus}
              selected={editSelectedSkus}
              setSelected={setEditSelectedSkus}
              perSkuMode={editPerSkuMode}
              onAreaChange={setEditArea}
            />
          </Field>

          {!editPerSkuMode && (
            <Field label="Единый метраж (м²)" required hint="Минимум 50 м² суммарно">
              <Input
                numeric
                inputMode="numeric"
                value={editAreaUnified}
                onChange={(e) =>
                  setEditAreaUnified(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
              />
            </Field>
          )}

          <Field label="Комментарий">
            <Textarea
              placeholder="Необязательно"
              value={editComment}
              onChange={(e) => setEditComment(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>

      {/* ---- дозаполнение закрытой защиты ---- */}
      {setUpdateClosedModal && (
        <Sheet
          open={!!updateClosedModal?.open}
          title={
            updateClosedModal?.mode === "success"
              ? "Отметить как успешную"
              : "Причина закрытия"
          }
          onClose={() => setUpdateClosedModal(emptyUpdateClosed)}
          actions={
            <>
              <Button variant="primary" block onClick={updateClosedProtection}>Сохранить</Button>
              <Button variant="ghost" block onClick={() => setUpdateClosedModal(emptyUpdateClosed)}>
                Отмена
              </Button>
            </>
          }
        >
          {updateClosedModal?.mode === "success" ? (
            <Field
              label="Документ 1С"
              hint="После сохранения защита попадёт в статистику как успешная"
            >
              <Input
                placeholder="Номер документа"
                value={updateClosedModal?.success_doc || ""}
                onChange={(e) =>
                  setUpdateClosedModal({ ...updateClosedModal, success_doc: e.target.value })
                }
              />
            </Field>
          ) : (
            <Field label="Причина закрытия" hint="Попадёт в историю защиты">
              <Textarea
                placeholder="Почему защита была закрыта"
                value={updateClosedModal?.close_reason || ""}
                onChange={(e) =>
                  setUpdateClosedModal({ ...updateClosedModal, close_reason: e.target.value })
                }
              />
            </Field>
          )}
        </Sheet>
      )}
    </>
  );
}

// frontend/src/pg/ActionSheets.jsx
// ============================================================
// Подтверждения и формы действий над защитой в новом оформлении.
// Состояние и обработчики те же, что у старых экранов, — компонент
// только рисует. Рендерится один раз на экране (список или карточка).
// ============================================================

import { useEffect, useState } from "react";
import { Button, Field, Icon, Input, Segment, Sheet, Textarea } from "./ui";
import EditProtectionFields from "./EditProtectionFields";
import { editProblem, hasEditChanges } from "./protection-edit";
import SkuPicker from "./SkuPicker";
import "./form.css";

const emptyClose = { open: false, id: null, reason: "" };
const emptySuccess = { open: false, id: null, doc: "" };
const emptyDelete = { open: false, id: null, reason: "" };
const emptyExtend = { open: false, id: null, reason: "", days: 10, message: "" };
const emptyUpdateClosed = {
  open: false, id: null, close_reason: "", success_doc: "", mode: "reason",
};

export default function ActionSheets({
  closeModal, setCloseModal, doClose,
  successModal, setSuccessModal, doSuccess,
  deleteModal, setDeleteModal, doDelete,
  extendRequestModal, setExtendRequestModal, submitExtendRequest,
  editModal, setEditModal, editSelectedSkus, setEditSelectedSkus,
  editPerSkuMode, setEditPerSkuMode, editAreaUnified, setEditAreaUnified,
  editComment, setEditComment, editDetails, setEditDetails, editSaving, submitEdit, skus, managers, auth,
  updateClosedModal, setUpdateClosedModal, updateClosedProtection,
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  useEffect(() => { if (!editModal?.open) setDiscardOpen(false); }, [editModal?.open]);
  const closeEdit = () => {
    if (editSaving) return;
    if (hasEditChanges({ item: editModal?.item, details: editDetails, selected: editSelectedSkus, perSkuMode: editPerSkuMode, unified: editAreaUnified, comment: editComment })) setDiscardOpen(true);
    else setEditModal({ open: false, id: null });
  };
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
        details: editDetails,
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
        open={!!editModal?.open && !discardOpen}
        title="Редактировать защиту"
        onClose={closeEdit}
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
              loading={editSaving}
              onClick={submitEdit}
            >
              Сохранить
            </Button>
            <Button variant="ghost" block disabled={editSaving} onClick={closeEdit}>
              Отмена
            </Button>
          </>
        }
      >
        <EditProtectionFields details={editDetails} setDetails={setEditDetails} managers={managers} item={editModal?.item} isAdmin={["admin", "superadmin"].includes(auth?.user?.role || auth?.role)} />
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

      <Sheet open={!!editModal?.open && discardOpen} title="Отменить изменения?" onClose={() => setDiscardOpen(false)} actions={<>
        <Button variant="primary" block onClick={() => setDiscardOpen(false)}>Продолжить редактирование</Button>
        <Button variant="danger-soft" block onClick={() => { setDiscardOpen(false); setEditModal({ open: false, id: null }); }}>Отменить изменения</Button>
      </>}><div className="pg-sheet__text">Несохранённые правки будут потеряны. Сохранённая защита останется прежней.</div></Sheet>

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

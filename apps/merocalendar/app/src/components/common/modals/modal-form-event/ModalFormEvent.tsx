import { ChangeEvent, FC, useEffect, useMemo, useRef, useState } from "react";
import { getContextIdentity } from "@calimero-network/mero-react";
import { useClickOutside, useForm, useMembers } from "../../../../hooks/index";
import {
  checkDateIsEqual,
  getDateTime,
  getDifferenceInTimeFromTwoTimes,
  getDifferenceOfTwoDates,
  shmoment,
} from "../../../../utils/date";
import { TSubmitHandler } from "../../../../hooks/useForm/types";
import { createEventSchema } from "../../../../validation-schemas/index";
import { IModalValues } from "./types";
import { TPartialEvent } from "../../../../types/event";
import { shortPk } from "../../../../hooks/useMembers";
import {
  TextField,
  DatePicker,
  ColorPicker,
} from "../../../../components/common/form-elements";
import cn from "classnames";

import styles from "./modal-form-event.module.scss";

interface IModalFormEventProps {
  textSendButton: string;
  textSendingBtn: string;
  defaultEventValues: IModalValues;
  closeModal: () => void;
  handlerSubmit: (eventData: TPartialEvent) => void;
}

const ModalFormEvent: FC<IModalFormEventProps> = ({
  textSendButton,
  textSendingBtn,
  closeModal,
  defaultEventValues,
  handlerSubmit,
}) => {
  // rc.8: the caller identity is the active context identity.
  const accountId = getContextIdentity();
  // FEATURE (missing names): members power the peer autocomplete (show username,
  // store pubkey).
  const { members, displayName } = useMembers();
  const modalRef = useRef<HTMLDivElement>(null);
  const peerBoxRef = useRef<HTMLDivElement>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const { values, handleChange, handleSubmit, setValue, errors, submitting } =
    useForm<IModalValues>({
      defaultValues: defaultEventValues,
      rules: createEventSchema,
    });

  const isValid = Object.keys(errors).length === 0;

  const onSelectStartDate = (date: Date) => {
    if (values.isLongEvent) {
      const { minutes } = getDifferenceOfTwoDates(values.startDate, values.endDate);
      const newEndDate = shmoment(date).add("minutes", minutes).result();
      setValue("endDate", newEndDate);
      setValue("startDate", date);
      return;
    }
    const oldStartDate = getDateTime(values.startDate, values.startTime);
    const newStartDate = getDateTime(date, values.startTime);
    const { minutes } = getDifferenceOfTwoDates(oldStartDate, values.endDate);
    const newEndDate = shmoment(newStartDate).add("minutes", minutes).result();
    setValue("endDate", newEndDate);
    setValue("startDate", newStartDate);
  };

  const onSelectEndDate = (date: Date) => {
    const endTime = values.isLongEvent ? "23:59" : values.endTime;
    setValue("endDate", getDateTime(date, endTime));
  };

  const onSelectStartTime = (time: string) => {
    const [startHours, startMins] = time.split(":");
    const { hours, minutes } = getDifferenceOfTwoDates(
      values.startDate,
      values.endDate,
    );
    const restHourFromDiff = +startMins + (minutes % 60) >= 60 ? 1 : 0;
    const newEndMins = ((+startMins + minutes) % 60).toString().padStart(2, "0");
    const newEndHours = (
      (+startHours + Math.floor(hours) + restHourFromDiff) %
      24
    )
      .toString()
      .padStart(2, "0");
    const newEndTime = `${newEndHours}:${newEndMins}`;
    const newEndDate = shmoment(getDateTime(values.startDate, time))
      .add("minutes", minutes)
      .result();
    setValue("startTime", time);
    setValue("endTime", newEndTime);
    setValue("endDate", newEndDate);
    setValue("startDate", getDateTime(values.startDate, time));
  };

  const onSelectEndTime = (time: string) => {
    const isDatesEqual = checkDateIsEqual(values.startDate, values.endDate);
    const { minutes } =
      isDatesEqual || !!errors.endDate
        ? getDifferenceInTimeFromTwoTimes(values.startTime, time)
        : getDifferenceOfTwoDates(
            values.startDate,
            getDateTime(values.endDate, time),
          );
    const newEndDate = shmoment(getDateTime(values.startDate, values.startTime))
      .add("minutes", minutes)
      .result();
    setValue("endTime", time);
    setValue("endDate", newEndDate);
  };

  const onChangeColor = (color: string) => setValue("color", color);

  const onToggleIsLongEvent = (e: ChangeEvent<HTMLInputElement>) => {
    const isLongEvent = e.target.checked;
    const startTime = isLongEvent ? "00:00" : values.startTime;
    const endTime = isLongEvent ? "23:59" : values.endTime;
    setValue("isLongEvent", isLongEvent);
    setValue("startDate", getDateTime(values.startDate, startTime));
    setValue("endDate", getDateTime(values.endDate, endTime));
  };

  const onToggleIsPrivate = (e: ChangeEvent<HTMLInputElement>) => {
    const isPrivate = e.target.checked;
    setValue("isPrivate", isPrivate);
    // Private events ignore peers — clear them when switching to private.
    if (isPrivate) setValue("peers", []);
  };

  const [error, setError] = useState<string | null>(null);

  const onSubmit: TSubmitHandler<IModalValues> = async (data) => {
    const newEvent: TPartialEvent = {
      title: data.title,
      description: data.description,
      // BUGFIX: peers are a real string[] of pubkeys end-to-end.
      peers: data.isPrivate ? [] : data.peers,
      start: data.startDate.toString(),
      end: data.endDate.toString(),
      type: data.isLongEvent ? "long-event" : "event",
      color: data.color,
      private: data.isPrivate,
    };

    try {
      // @ts-ignore — handlerSubmit returns the dispatched thunk (has .unwrap)
      await handlerSubmit(newEvent).unwrap();
      closeModal();
    } catch (err: any) {
      setError(`Error: ${err?.message ?? err}`);
    }
  };

  // @ts-ignore — useClickOutside ref typing
  useClickOutside(modalRef, closeModal);

  useEffect(() => {
    if (textSendButton === "Edit") {
      // Only the owner can edit; everyone else opens in view-only mode.
      setViewOnly(accountId !== defaultEventValues.owner);
    }
  }, [accountId, defaultEventValues.owner, textSendButton]);

  // ── Peer multi-select autocomplete ──────────────────────────────────────────
  // BUGFIX (brittle peer entry): replace the `@`/comma string parsing with a
  // clean type-ahead over members. Selected peers are stored as a string[] of
  // pubkeys and rendered as removable chips with their usernames.
  const [peerQuery, setPeerQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  useClickOutside(peerBoxRef as any, () => setShowDropdown(false));

  const selectedPeers = values.peers ?? [];

  const candidates = useMemo(() => {
    const q = peerQuery.trim().toLowerCase();
    return members
      .filter((m) => m.id !== accountId) // can't invite yourself
      .filter((m) => !selectedPeers.includes(m.id)) // not already added
      .filter(
        (m) =>
          !q ||
          m.username?.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      );
  }, [members, peerQuery, selectedPeers, accountId]);

  const addPeer = (pk: string) => {
    if (!selectedPeers.includes(pk)) setValue("peers", [...selectedPeers, pk]);
    setPeerQuery("");
    setShowDropdown(false);
  };

  const removePeer = (pk: string) => {
    setValue(
      "peers",
      selectedPeers.filter((p) => p !== pk),
    );
  };

  return (
    <div className="overlay">
      {/* @ts-ignore — modalRef typing */}
      <div className={styles.modal} ref={modalRef}>
        <div className={styles.modal__content}>
          <button className={styles.modal__content__close} onClick={closeModal}>
            <i className="fas fa-times"></i>
          </button>
          <form className={styles.modal__form} onSubmit={handleSubmit(onSubmit)}>
            <TextField
              type="text"
              name="title"
              placeholder="Title"
              onChange={handleChange}
              value={values.title}
              error={errors.title}
              className={styles.modal__form__title}
              fullWidth
              readOnly={viewOnly}
            />
            <div className={cn(styles.modal__form__date, styles.modal__form__group)}>
              <DatePicker
                selectedDate={values.startDate}
                selectDate={onSelectStartDate}
                error={errors.startDate}
              />
              {!values.isLongEvent && (
                <div className={styles.modal__form__time}>
                  <input
                    type="time"
                    value={values.startTime}
                    onChange={(e) => onSelectStartTime(e.target.value)}
                    className={styles.modal__form__time__input}
                    readOnly={viewOnly}
                  />
                  <span>-</span>
                  <input
                    type="time"
                    value={values.endTime}
                    onChange={(e) => onSelectEndTime(e.target.value)}
                    className={styles.modal__form__time__input}
                    readOnly={viewOnly}
                    min={values.startTime}
                  />
                </div>
              )}
              {values.isLongEvent && (
                <div className={styles.modal__form__time__separator}>-</div>
              )}
              <div>
                <DatePicker
                  selectedDate={values.endDate}
                  selectDate={onSelectEndDate}
                  error={errors.endDate}
                />
              </div>
            </div>
            {(!!errors.startDate ||
              !!errors.endDate ||
              !!errors.startTime ||
              !!errors.endTime) && (
              <div className={styles.modal__form__error}>
                {errors.startDate ??
                  errors.endDate ??
                  errors.startTime ??
                  errors.endTime}
              </div>
            )}
            {!viewOnly && (
              <div
                className={cn(
                  styles.modal__form__checkbox__container,
                  styles.modal__form__group,
                )}
              >
                <label htmlFor="type">
                  <input
                    type="checkbox"
                    name="type"
                    id="type"
                    onChange={onToggleIsLongEvent}
                    checked={values.isLongEvent}
                  />
                  <span className={styles.modal__form__checkbox__title}>All day</span>
                </label>
                {/* FEATURE: private toggle — routes to *_private_event methods */}
                <label htmlFor="private" className={styles.modal__form__private}>
                  <input
                    type="checkbox"
                    name="private"
                    id="private"
                    onChange={onToggleIsPrivate}
                    checked={values.isPrivate}
                    data-testid="private-toggle"
                  />
                  <span className={styles.modal__form__checkbox__title}>
                    Private (only on my node)
                  </span>
                </label>
              </div>
            )}
            {!viewOnly && (
              <div className={styles.modal__form__group}>
                <div className={styles.modal__form__group__title}>
                  Select event color
                </div>
                <ColorPicker
                  selectedColor={values.color}
                  onChangeColor={onChangeColor}
                  readOnly={viewOnly}
                />
              </div>
            )}

            {/* Peer multi-select — hidden for private events (they don't sync) */}
            {!values.isPrivate && (
              <div className={styles.modal__form__group}>
                <div className={styles.modal__form__group__title}>Invite peers</div>
                <div className={styles.peers} ref={peerBoxRef}>
                  <div className={styles.peers__chips}>
                    {selectedPeers.map((pk) => (
                      <span key={pk} className={styles.peers__chip} title={pk}>
                        {displayName(pk)}
                        {!viewOnly && (
                          <button
                            type="button"
                            className={styles.peers__chipRemove}
                            onClick={() => removePeer(pk)}
                            aria-label={`Remove ${displayName(pk)}`}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    ))}
                    {!viewOnly && (
                      <input
                        className={styles.peers__input}
                        value={peerQuery}
                        placeholder={
                          selectedPeers.length ? "Add another…" : "Search teammates…"
                        }
                        onChange={(e) => {
                          setPeerQuery(e.target.value);
                          setShowDropdown(true);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        data-testid="peer-search"
                      />
                    )}
                  </div>
                  {!viewOnly && showDropdown && candidates.length > 0 && (
                    <ul className={styles.peers__dropdown}>
                      {candidates.slice(0, 8).map((m) => (
                        <li
                          key={m.id}
                          className={styles.peers__option}
                          onClick={() => addPeer(m.id)}
                        >
                          <span className={styles.peers__optionName}>
                            {m.username?.trim() || shortPk(m.id)}
                          </span>
                          <span className={styles.peers__optionPk}>
                            {shortPk(m.id)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!viewOnly &&
                    showDropdown &&
                    candidates.length === 0 &&
                    members.length === 0 && (
                      <div className={styles.peers__empty}>
                        No teammates have joined yet.
                      </div>
                    )}
                </div>
              </div>
            )}

            <div
              className={cn(
                styles.modal__form__textarea__container,
                styles.modal__form__group,
              )}
            >
              <textarea
                name="description"
                placeholder="Description"
                className={styles.modal__form__textarea}
                onChange={handleChange}
                value={values.description}
                readOnly={viewOnly}
              />
            </div>
            {error && <div className={styles.modal__form__error}>{error}</div>}
            {!viewOnly && (
              <button
                type="submit"
                className={styles.modal__form__btn}
                disabled={submitting || !isValid}
                data-testid="event-submit"
              >
                {submitting ? textSendingBtn : textSendButton}
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default ModalFormEvent;

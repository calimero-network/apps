// Screenshot harness entry — the REAL ModalFormEvent, its real CSS modules, its
// real useForm/useValidator, against a fixture member list and no session.
//
// `?theme=dark|light` picks the palette; the whole point of the shot is that the
// form is legible in both.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
// The app's REAL store. Something in the modal's tree reaches for redux at
// render (the harness first failed with "Cannot destructure property 'store' of
// null"), and supplying the production store is both less guesswork than
// hunting the caller and less of a lie than a hand-rolled fake one.
import { store } from "../../src/store/store";
import ModalFormEvent from "../../src/components/common/modals/modal-form-event/ModalFormEvent";
import type { IModalValues } from "../../src/components/common/modals/modal-form-event/types";
import "../../src/index.module.scss";
import "../../src/styles/theme.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "dark";

// A part-filled form: a title being typed, a description, one peer chosen and
// one field left invalid, so the error tint is in the shot too.
const values: IModalValues = {
  title: "Sprint review",
  startDate: new Date("2026-09-10T00:00:00"),
  endDate: new Date("2026-09-10T00:00:00"),
  peers: ["b2".repeat(32)],
  startTime: "14:00",
  endTime: "15:30",
  description: "Walk the board, then the demo.",
  isLongEvent: false,
  isPrivate: false,
  color: "#6c8cff",
  owner: "a1".repeat(32),
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
        <ModalFormEvent
        textSendButton="Create"
        textSendingBtn="Creating…"
        defaultEventValues={values}
        closeModal={() => {}}
        handlerSubmit={() => {}}
      />
    </Provider>
  </StrictMode>,
);

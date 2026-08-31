import { createSlice } from "@reduxjs/toolkit";
import { IEventsState } from "./types";
import {
  getEvents,
  getMembers,
  createEvent,
  updateEvent,
  deleteEvent,
} from "./actions";

const initialState: IEventsState = {
  events: [],
  members: [],
};

export const eventsSlice = createSlice({
  name: "events",
  initialState,
  extraReducers: (builder) => {
    builder
      .addCase(getEvents.fulfilled, (state, { payload }) => {
        state.events = payload;
      })
      .addCase(getMembers.fulfilled, (state, { payload }) => {
        state.members = payload;
      })
      .addCase(updateEvent.fulfilled, (state, { payload }) => {
        // payload = { eventId, event: TPartialEvent } — merge the patch in place.
        const { eventId, event } = payload;
        state.events = state.events.map((e) =>
          e.id === eventId ? { ...e, ...event } : e,
        );
      })
      .addCase(deleteEvent.fulfilled, (state, { payload }) => {
        const { eventId } = payload;
        state.events = state.events.filter((event) => event.id !== eventId);
      })
      .addCase(createEvent.fulfilled, (state, { payload }) => {
        state.events = [...state.events, payload];
      });
  },
  reducers: {},
});

export const { reducer } = eventsSlice;

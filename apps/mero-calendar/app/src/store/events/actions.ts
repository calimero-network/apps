import { createAsyncThunk } from "@reduxjs/toolkit";
import { IEvent, IEventCreate, Member, TPartialEvent } from "../../types/event";
import { ClientApiDataSource } from "../../api/dataSource/ClientApiDataSource";

const apiEvents = new ClientApiDataSource();

export const getEvents = createAsyncThunk<IEvent[], void>(
  "events/get-events",
  async (_, thunkAPI) => {
    try {
      const response = await apiEvents.getEvents();
      if (!response?.data) {
        throw new Error(response.error?.message ?? "Failed to load events");
      }
      return response.data as IEvent[];
    } catch (error) {
      return thunkAPI.rejectWithValue(error);
    }
  },
);

export const getMembers = createAsyncThunk<Member[], void>(
  "events/get-members",
  async (_, thunkAPI) => {
    try {
      const response = await apiEvents.getMembers();
      if (response.error) throw new Error(response.error.message);
      return (response.data as Member[]) ?? [];
    } catch (error) {
      return thunkAPI.rejectWithValue(error);
    }
  },
);

// BUGFIX (createEvent id lost): the data source returns a bare id string in
// `response.data`. The old code read `response.data.eventId` (undefined). We
// build the full IEvent here so the reducer can append it optimistically; SSE
// will reconcile shortly after via getEvents().
export const createEvent = createAsyncThunk<IEvent, IEventCreate>(
  "events/create-event",
  async (newEvent, thunkAPI) => {
    try {
      const response = await apiEvents.createEvent(newEvent);
      if (!response?.data || typeof response.data !== "string") {
        throw new Error(response.error?.message ?? "No event id received");
      }
      const created: IEvent = {
        id: response.data,
        title: newEvent.title,
        description: newEvent.description,
        start: newEvent.start,
        end: newEvent.end,
        peers: newEvent.peers,
        type: newEvent.type,
        color: newEvent.color,
        owner: newEvent.owner,
        private: newEvent.private,
      };
      return created;
    } catch (error) {
      return thunkAPI.rejectWithValue(error);
    }
  },
);

export const updateEvent = createAsyncThunk<
  { eventId: string; event: TPartialEvent },
  { eventId: string; event: TPartialEvent }
>("events/update-event", async ({ eventId, event }, thunkAPI) => {
  try {
    const response = await apiEvents.updateEvent(eventId, event);
    if (!response?.data || typeof response.data !== "string") {
      throw new Error(response.error?.message ?? "No valid string data received");
    }
    // Return the patch so the reducer can merge it into the stored event.
    return { eventId, event };
  } catch (error) {
    return thunkAPI.rejectWithValue(error);
  }
});

export const deleteEvent = createAsyncThunk<
  { eventId: string },
  { eventId: string; isPrivate: boolean }
>("events/delete-event", async ({ eventId, isPrivate }, thunkAPI) => {
  try {
    await apiEvents.deleteEvent(eventId, isPrivate);
    return { eventId };
  } catch (error) {
    return thunkAPI.rejectWithValue(error);
  }
});

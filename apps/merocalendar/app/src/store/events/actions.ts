import { createAsyncThunk } from '@reduxjs/toolkit'
import { IEvent, IEventCreate, TPartialEvent } from '../../types/event';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';
import mockEvents from '../../utils/mocks';

const apiEvents = new ClientApiDataSource();

export const getEvents = createAsyncThunk<IEvent[], void>(
  'events/get-events',
  async (_, thunkAPI) => {
    try {
      return mockEvents
      // const response = await apiEvents.getEvents();
      // if (!response?.data) {
      //   throw new Error('No data received');
      // }
    } catch (error) {
      return thunkAPI.rejectWithValue(error)
    }
  }
)

export const createEvent = createAsyncThunk<IEvent, IEventCreate>(
  'events/create-event',
  async (newEvent, thunkAPI) => {
    console.log("create event", newEvent);
    try {
      const response = await apiEvents.createEvent(newEvent);
      if (!response?.data) {
        throw new Error('No data received');
      }
      return response.data as IEvent;
    } catch (error) {
      return thunkAPI.rejectWithValue(error)
    }
  }
)

export const updateEvent = createAsyncThunk<
  { eventId: string, updatedEvent: IEvent },
  { eventId: string, event: TPartialEvent }
>(
  'events/update-event',
  async ({ eventId, event }, thunkAPI) => {
    try {
      const response = await apiEvents.updateEvent(eventId, event);
      if (!response?.data) {
        throw new Error('No data received');
      }
      return { eventId, updatedEvent: response.data as IEvent };
    } catch (error) {
      return thunkAPI.rejectWithValue(error)
    }
  }
)

export const deleteEvent = createAsyncThunk<
  { eventId: string },
  string
>(
  'events/delete-event',
  async (eventId, thunkAPI) => {
    try {
      await apiEvents.deleteEvent(eventId);
      return { eventId };
    } catch (error) {
      return thunkAPI.rejectWithValue(error)
    }
  }
)
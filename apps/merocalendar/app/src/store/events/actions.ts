import { createAsyncThunk } from '@reduxjs/toolkit'
import { IEvent, IEventCreate, TPartialEvent } from '../../types/event';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';

const apiEvents = new ClientApiDataSource();

export const getEvents = createAsyncThunk<IEvent[], void>(
  'events/get-events',
  async (_, thunkAPI) => {
    try {
      const response = await apiEvents.getEvents();
      if (!response?.data) {
        throw new Error(response.error.message);
      }
      return response.data as IEvent[];
    } catch (error) {
      return thunkAPI.rejectWithValue(error)
    }
  }
)

export const createEvent = createAsyncThunk<string, IEventCreate>(
  'events/create-event',
  async (newEvent, thunkAPI) => {
    try {
      const response = await apiEvents.createEvent(newEvent);
      console.log(response);
      if (!response?.data) {
        throw new Error('No data received');
      }
      return response.data.eventId;
    } catch (error) {
      console.log(error);
      return thunkAPI.rejectWithValue(error)
    }
  }
)

export const updateEvent = createAsyncThunk<
  string,
  { eventId: string, event: TPartialEvent }
>(
  'events/update-event',
  async ({ eventId, event }, thunkAPI) => {
    try {
      const response = await apiEvents.updateEvent(eventId, event);
      if (!response?.data || typeof response.data !== 'string') {
        throw new Error('No valid string data received');
      }
      return response;
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
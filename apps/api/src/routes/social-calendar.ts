import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  calendarDayPostSchema,
  calendarFillSchema,
  type CalendarDayPostDto,
  type CalendarPlanItemDto,
  type HolidayDto,
} from "@catgpt/types";
import { badRequest, parseBody } from "../lib/errors.js";
import { createDayPost, fillCalendar, listHolidays, listPlanItems } from "../services/social-calendar.js";

const rangeQuery = z.object({ from: z.string().datetime(), to: z.string().datetime() });
const ymdRange = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function socialCalendarRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/social/holidays", async (req): Promise<{ items: HolidayDto[] }> => {
    const q = parseBody(ymdRange, req.query);
    if (q.to < q.from || new Date(q.to).getTime() - new Date(q.from).getTime() > 93 * 86_400_000) {
      throw badRequest("Invalid date range");
    }
    return { items: await listHolidays(q.from, q.to) };
  });

  app.get("/social/calendar-plan", async (req): Promise<{ items: CalendarPlanItemDto[] }> => {
    const q = parseBody(rangeQuery, req.query);
    return { items: await listPlanItems(req.userId, new Date(q.from), new Date(q.to)) };
  });

  // Each call starts a paid image generation / model call, so keep them tight.
  const limit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  app.post("/social/calendar/day-post", limit, async (req, reply): Promise<CalendarDayPostDto> => {
    const body = parseBody(calendarDayPostSchema, req.body);
    return reply.code(201).send(await createDayPost(req.userId, body));
  });

  app.post("/social/calendar/fill", limit, async (req, reply) => {
    const body = parseBody(calendarFillSchema, req.body);
    return reply.code(201).send(await fillCalendar(req.userId, body));
  });
}

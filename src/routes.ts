import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import dayjs from "dayjs"

export async function appRoutes(app: FastifyInstance) {
    app.post("/habits", async (request) => {
        const createHabitBody = z.object({
            title: z.string(),
            weekDays: z.array(z.number().min(0).max(6))
        });

        const { title, weekDays } = createHabitBody.parse(request.body);

        const today = dayjs().startOf("day").toDate();

        await prisma.habit.create({
            data: {
                title, 
                created_at: today,
                weekDays: {
                    create: weekDays.map(weekDay => {
                        return {
                            week_day: weekDay
                        }
                    })
                }
            }
        });
    })

    app.get("/day", async (request) => {
        const getDayParams = z.object({
            date: z.coerce.date()
        })

        const { date } = getDayParams.parse(request.query);

        const parsedDate = dayjs(date).startOf("day");
        const weekDay = parsedDate.get("day");

        const possibleHabits = await prisma.habit.findMany({
            where: {
                created_at: {
                    lt: parsedDate.toDate(),
                },
                weekDays: {
                    some: {
                        week_day: weekDay
                    }
                }
            }
        })

        const day = await prisma.day.findFirst({
            where: {
                date: parsedDate.toDate()
            },
            include: {
                dayHabits: true
            }
        })

        const completedHabits = day?.dayHabits.map(dayHabit => {
            return dayHabit.habit_id;
        })

        return {
            possibleHabits,
            completedHabits
        }
    })

    app.patch("/habits/:id/toggle", async (request) => {
        const toggleHabitParams = z.object({
            id: z.string().uuid()
        })
        
        const { id } = toggleHabitParams.parse(request.params)

        const today = dayjs().startOf("day").toDate()

        let day = await prisma.day.findUnique({
            where: {
                date: today
            }
        })

        if (!day) {
            day = await prisma.day.create({
                data: {
                    date: today
                }
            }) 
        }

        const dayHabit = await prisma.dayHabit.findUnique({
            where: {
                day_id_habit_id: {
                    day_id: day.id,
                    habit_id: id
                }
            }
        })

        if (dayHabit) {
            await prisma.dayHabit.delete({
                where: {
                    id: dayHabit.id
                }
            })

        } else {
            await prisma.dayHabit.create({
                data: {
                    day_id: day.id,
                    habit_id: id
                }
            })
        }
    })

    app.get("/summary",async (request) => {
        const summary = await prisma.$queryRaw`
            SELECT
                day.id,
                day.date,
                (
                    SELECT cast(count(*) as float)
                        FROM day_habits dayhabit
                    WHERE dayhabit.day_id = day.id 
                ) as completed,
                (
                    SELECT cast(count(*) as float)
                        FROM habit_week_days hwd
                        JOIN habits h
                        ON h.id = hwd.habit_id
                    WHERE hwd.week_day = cast(strftime('%w', day.date / 1000, 'unixepoch') as int)
                        AND h.created_at <= day.date
                ) as amount
            FROM
                days day
        `
        
        return summary
    })
}

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const guests = sqliteTable('v2_guests', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').default('Umum'),
  phone: text('phone'),
  sent: integer('sent').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index('idx_v2_guests_name').on(table.name),
  index('idx_v2_guests_created').on(table.createdAt)
]);

export const rsvps = sqliteTable('v2_rsvps', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  city: text('city'),
  category: text('category').default('Umum'),
  attendance: text('attendance').notNull(),
  pax: integer('pax').default(1),
  message: text('message'),
  isVisible: integer('is_visible').default(1),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index('idx_v2_rsvps_created').on(table.createdAt),
  index('idx_v2_rsvps_visible_created').on(table.isVisible, table.createdAt)
]);

export const siteConfig = sqliteTable('v2_site_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});


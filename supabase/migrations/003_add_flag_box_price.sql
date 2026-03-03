-- Add flag_box_price to capture box MRP when picker flags "Price Mismatch"
ALTER TABLE order_items
ADD COLUMN flag_box_price NUMERIC(10,2);


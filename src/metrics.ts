export const RULES = [
  "customer_id is unique PER ORDER, not per person. To count real customers, use COUNT(DISTINCT customers.customer_unique_id).",
  "Category names in products are Portuguese. Always show English names: LEFT JOIN category_translation ct ON ct.product_category_name = p.product_category_name and use COALESCE(ct.product_category_name_english, p.product_category_name).",
  "Data covers roughly 2016 to 2018. The first and last few months have very few orders, so mention this when showing trends.",
];

export const METRICS = [
  {
    name: "revenue",
    description: "Total sales value including shipping, for delivered orders only.",
    formula: "SUM(oi.price + oi.freight_value)",
    from: "order_items oi JOIN orders o ON o.order_id = oi.order_id",
    filter: "o.order_status = 'delivered'",
  },
  {
    name: "product_revenue",
    description: "Sales value excluding shipping, for delivered orders only.",
    formula: "SUM(oi.price)",
    from: "order_items oi JOIN orders o ON o.order_id = oi.order_id",
    filter: "o.order_status = 'delivered'",
  },
  {
    name: "average_order_value",
    description: "Revenue divided by the number of delivered orders.",
    formula: "SUM(oi.price + oi.freight_value) / COUNT(DISTINCT o.order_id)",
    from: "order_items oi JOIN orders o ON o.order_id = oi.order_id",
    filter: "o.order_status = 'delivered'",
  },
  {
    name: "delivery_time_days",
    description: "Days from purchase to delivery to the customer.",
    formula: "EXTRACT(EPOCH FROM (o.order_delivered_customer_date - o.order_purchase_timestamp)) / 86400",
    from: "orders o",
    filter: "o.order_status = 'delivered' AND o.order_delivered_customer_date IS NOT NULL",
  },
  {
    name: "delivery_delay_days",
    description: "Days delivered after the estimated date. Positive means late, negative means early.",
    formula: "EXTRACT(EPOCH FROM (o.order_delivered_customer_date - o.order_estimated_delivery_date)) / 86400",
    from: "orders o",
    filter: "o.order_status = 'delivered' AND o.order_delivered_customer_date IS NOT NULL",
  },
  {
    name: "late_delivery_rate",
    description: "Share of delivered orders that arrived after the estimated date.",
    formula: "AVG(CASE WHEN o.order_delivered_customer_date > o.order_estimated_delivery_date THEN 1.0 ELSE 0 END)",
    from: "orders o",
    filter: "o.order_status = 'delivered' AND o.order_delivered_customer_date IS NOT NULL",
  },
  {
    name: "average_review_score",
    description: "Mean customer review score from 1 to 5.",
    formula: "AVG(r.review_score)",
    from: "order_reviews r",
    filter: "none",
  },
  {
    name: "unique_customers",
    description: "Number of distinct real customers (people, not orders).",
    formula: "COUNT(DISTINCT c.customer_unique_id)",
    from: "customers c",
    filter: "none",
  },
];
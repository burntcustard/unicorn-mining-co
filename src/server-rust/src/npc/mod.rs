//! Navigation and flight forecasts for non-player ships.

pub mod collection;
pub mod collector;
pub mod collector_control;
pub mod contact_forecast;
pub mod flight;
pub mod marauder;
pub mod navigation;
pub mod perception;
pub mod pirate;
pub mod prediction;
pub mod route;
pub mod steering;
pub mod world_host;

#[cfg(test)]
mod tests;

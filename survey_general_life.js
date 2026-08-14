"use strict";
// 36 everyday-life scenarios × 5 differently framed survey prompts = 180 boards.
const scenarios = [
  ["check before leaving home",["Keys","Phone","Wallet","Door locks","Lights"]],
  ["do before going to bed",["Brush teeth","Lock doors","Set alarm","Charge phone","Drink water"]],
  ["do after arriving home from work",["Change clothes","Eat something","Rest","Shower","Check phone"]],
  ["do first in the morning",["Check phone","Use bathroom","Brush teeth","Drink something","Get dressed"]],
  ["prepare before grocery shopping",["Shopping list","Budget","Check fridge","Shopping bags","Transport"]],
  ["use when cleaning the house",["Vacuum cleaner","Dish soap","Laundry basket","Duster","Mop"]],
  ["prepare before guests arrive",["Tidy rooms","Food","Drinks","Bathroom","Music"]],
  ["check before a long road trip",["Fuel","Tyres","Directions","Snacks","Luggage"]],
  ["check before travelling by air",["Passport","Ticket","Luggage","Departure time","Airport transport"]],
  ["prepare when heavy rain is expected",["Umbrella","Close windows","Bring washing in","Plan for traffic","Waterproof shoes"]],
  ["prepare before a power cut",["Charge phones","Candles","Torch","Protect food","Generator"]],
  ["take to a doctor appointment",["Symptoms list","Medical aid card","Questions","Medication","Appointment time"]],
  ["prepare for a job interview",["CV","Smart outfit","Company research","Directions","Questions"]],
  ["check before going on a first date",["Outfit","Venue","Money","Fresh breath","Phone battery"]],
  ["prepare before attending a party",["Outfit","Gift","Directions","Transport","Starting time"]],
  ["arrange for a birthday celebration",["Cake","Gifts","Guest list","Food","Decorations"]],
  ["prepare for a school day",["Uniform","Homework","Lunch","School bag","Transport"]],
  ["check before an online meeting",["Microphone","Camera","Internet","Background","Notes"]],
  ["pay for soon after payday",["Household bills","Groceries","Savings","Debt","Personal treat"]],
  ["organise before moving house",["Boxes","Moving transport","Labels","Utilities","New keys"]],
  ["buy when preparing for a new baby",["Nappies","Baby clothes","Feeding supplies","Cot","Medical supplies"]],
  ["provide when caring for a pet",["Food","Water","Shelter","Exercise","Vet care"]],
  ["check before cooking dinner",["Ingredients","Cooking time","Stove","Recipe","Portions"]],
  ["consider when choosing a restaurant",["Menu","Prices","Service","Cleanliness","Location"]],
  ["check when shopping for clothes",["Size","Price","Fit","Quality","Colour"]],
  ["consider when buying a new phone",["Price","Battery life","Camera","Storage","Brand"]],
  ["do during a normal weekend",["Sleep longer","House chores","Visit family","Shopping","Entertainment"]],
  ["prepare before going on holiday",["Bookings","Luggage","Travel documents","Money","Weather forecast"]],
  ["check before attending a wedding",["Outfit","Gift","Venue","Starting time","Transport"]],
  ["prepare before attending a funeral",["Appropriate outfit","Condolence message","Directions","Flowers","Starting time"]],
  ["take to the gym",["Water bottle","Workout clothes","Towel","Headphones","Membership card"]],
  ["decide before a hair appointment",["Hairstyle","Price","Appointment time","Reference picture","Payment method"]],
  ["check regularly on a car",["Fuel","Tyre pressure","Engine oil","Coolant","Lights"]],
  ["check before using public transport",["Fare","Route","Departure time","Safety","Destination"]],
  ["use to improve home security",["Door locks","Closed windows","Alarm","Outdoor lights","Security gate"]],
  ["include in a monthly household budget",["Income","Bills","Food","Transport","Savings"]]
];
const frames = [
  action => `Name something people usually ${action}.`,
  action => `Name something someone might forget to ${action}.`,
  action => `Name something a careful person would ${action}.`,
  action => `Name something families often ${action}.`,
  action => `Name something people may rush to ${action}.`
];
const points = [31,25,19,14,11];
const singular = text => text.endsWith("s") ? text.slice(0,-1) : text;
const rows=[];
for(const [scenarioIndex,[action,answers]] of scenarios.entries()){
  for(const frame of frames){
    rows.push({id:`survey_${String(rows.length+21).padStart(3,"0")}`,category:"General Life",group:`general_${scenarioIndex+1}`,question:frame(action),answers:answers.map((text,i)=>({text,points:points[i],aliases:[singular(text),text.toLowerCase()]}))});
  }
}
module.exports=rows;

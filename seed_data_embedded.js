// Embedded seed data — operational customer/job data cleared for blank-slate testing
// Kept: users, vehicles, service_categories, service_products, waste_sites
module.exports = {
  "customers": [],
  "jobs": [],
  "users": [
    {
      "name": "Tyler",
      "phone": "2075422259",
      "username": "tyler",
      "password_hash": "$2b$10$B1no5ua7ONjO.mHB6mFHwOuvgpxQP5810IM.segUgmvmpaMwNmxcG",
      "role": "admin",
      "id": "b2a44ce6-4a8f-485f-90a9-8777723e15ef",
      "created_at": "2026-03-14T20:27:15.262Z",
      "updated_at": "2026-03-14T20:27:15.262Z"
    },
    {
      "name": "Clyde Collins",
      "phone": "",
      "username": "clyde.collins",
      "role": "tech",
      "id": "1f4095bc-2846-45c8-8ebb-c0af7dd2ee7b",
      "created_at": "2026-03-15T22:08:30.262Z",
      "updated_at": "2026-03-15T22:08:30.262Z"
    },
    {
      "name": "Dan Greiner",
      "phone": "",
      "username": "dan.greiner",
      "role": "tech",
      "id": "f71d2a24-03b2-436b-9d51-2d4a875fd031",
      "created_at": "2026-03-15T22:08:30.263Z",
      "updated_at": "2026-03-15T22:08:30.263Z"
    },
    {
      "name": "Roy Grotton",
      "phone": "",
      "username": "roy.grotton",
      "role": "tech",
      "id": "aac46ea4-ad9c-4660-812d-0d44313f93d3",
      "created_at": "2026-03-15T22:08:30.263Z",
      "updated_at": "2026-03-15T22:08:30.263Z"
    },
    {
      "name": "Josh Hallowell",
      "phone": "",
      "username": "josh.hallowell",
      "role": "tech",
      "id": "fffc57cf-8a2a-48c0-beea-db680be951d1",
      "created_at": "2026-03-15T22:08:30.263Z",
      "updated_at": "2026-03-15T22:08:30.263Z"
    },
    {
      "name": "Chris",
      "phone": "",
      "username": "chris",
      "role": "tech",
      "id": "1940d691-3b28-4d03-931e-dd7a82464c43",
      "created_at": "2026-03-15T22:08:30.263Z",
      "updated_at": "2026-03-15T22:08:30.263Z"
    }
  ],
  "properties": [],
  "tanks": [],
  "vehicles": [
    {
      "name": "2017 Mack",
      "capacity_gallons": 4400,
      "color": "#81b6b6",
      "default_tech_id": null,
      "plate": "",
      "sort_order": 0,
      "id": "16d4db35-1d59-4fb9-8daa-3d5101f45375",
      "created_at": "2026-03-14T20:15:49.957Z",
      "updated_at": "2026-03-14T20:16:27.716Z"
    },
    {
      "name": "2016 Mack",
      "capacity_gallons": 4400,
      "color": "#1565c0",
      "default_tech_id": null,
      "plate": "",
      "sort_order": 0,
      "id": "129ebf19-b26d-4f62-894b-016ec624df63",
      "created_at": "2026-03-14T20:16:04.206Z",
      "updated_at": "2026-03-14T20:16:04.206Z"
    },
    {
      "name": "2014 Mack",
      "capacity_gallons": 4400,
      "color": "#21c115",
      "default_tech_id": "b2a44ce6-4a8f-485f-90a9-8777723e15ef",
      "plate": "",
      "sort_order": 0,
      "id": "140f1d5e-f640-462a-915a-c64af2f55ae2",
      "created_at": "2026-03-14T20:16:19.400Z",
      "updated_at": "2026-03-14T20:31:39.599Z"
    },
    {
      "name": "2004 Kenworth",
      "capacity_gallons": 4200,
      "color": "#5115c1",
      "default_tech_id": null,
      "plate": "",
      "sort_order": 0,
      "id": "0af2343a-04c4-4a3c-94bf-9daa0855c143",
      "created_at": "2026-03-14T20:16:40.847Z",
      "updated_at": "2026-03-14T20:16:40.847Z"
    },
    {
      "name": "Service Truck",
      "capacity_gallons": 0,
      "color": "#878c92",
      "default_tech_id": null,
      "plate": "",
      "sort_order": 0,
      "id": "eeddf5aa-5819-4295-a8a6-7337726c9957",
      "created_at": "2026-03-14T20:16:52.661Z",
      "updated_at": "2026-03-14T20:16:52.661Z"
    },
    {
      "name": "Box Truck",
      "capacity_gallons": 0,
      "color": "#737425",
      "default_tech_id": null,
      "plate": "",
      "sort_order": 0,
      "id": "dfbc2371-708f-4b99-b1b4-e74bad3492f7",
      "created_at": "2026-03-14T20:17:11.519Z",
      "updated_at": "2026-03-14T20:17:11.519Z"
    }
  ],
  "invoices": [],
  "service_categories": [
    {
      "id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Septic Truck Services",
      "code": "Septic",
      "sort_order": 1,
      "created_at": "2026-03-15T23:30:54.775Z"
    },
    {
      "id": "c4708965-4338-4b81-8fce-c963b8046b16",
      "name": "Box Truck Services",
      "code": "Box Tru",
      "sort_order": 2,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "fe8b090a-bf1d-465c-8414-62346fb5dee5",
      "name": "Service Truck",
      "code": "Service",
      "sort_order": 3,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Additional Services",
      "code": "Additio",
      "sort_order": 4,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "General",
      "code": "Gen",
      "sort_order": 5,
      "created_at": "2026-03-15T23:30:54.785Z"
    }
  ],
  "service_products": [
    {
      "id": "2351ce18-965b-450e-b2bf-71e4600377c2",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Pumping",
      "price": 250,
      "job_code": "",
      "is_pump_job": true,
      "is_tank_job": true,
      "sort_order": 1,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "5f136be3-25fc-4f3b-86c9-477d50fac1f8",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Septic Tank Waste Disposal",
      "price": 140,
      "job_code": "Su",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 2,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "ed6cf3ac-a3d4-4848-9d11-1f181a0edb89",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Holding Tank Waste Disposal",
      "price": 130,
      "job_code": "Hu",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 3,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "ad051153-3cbd-4da4-a223-f0a33a408a68",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Grease Tank Waste Disposal",
      "price": 160,
      "job_code": "Gu",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 4,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "80c72630-51b7-45dc-a599-c7154f3decb4",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Treatment Plant Waste Disposal",
      "price": 140,
      "job_code": "Tp",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 5,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "0726b544-e06c-420c-814a-94d1973cf5d5",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Liquid Seaweed Waste Disposal",
      "price": 130,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 6,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "21af9ed2-bd7b-4907-b8e1-48ff71bbece8",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Brewery Waste Disposal",
      "price": 140,
      "job_code": "Bw",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 7,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "95e0d225-397c-4f10-b584-4f3ac4328fa0",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Non Septic/Non Hazardous Liquids Disposal",
      "price": 140,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 8,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "2829f78f-d632-4cc0-9492-33ad913dd6fa",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Extra Hose",
      "price": 10,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 9,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "6ac15ddb-bf6c-4959-9250-67c5b433ce44",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Expedited Service",
      "price": 150,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 10,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "d8cb578c-a149-4d46-9043-546a49533bbc",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Interior Grease Trap",
      "price": 260,
      "job_code": "Ig",
      "is_pump_job": true,
      "is_tank_job": true,
      "sort_order": 11,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "7eccfd3f-eff7-45fd-b501-8666b45b3e6a",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Less Than 100 Gallons Pump Out",
      "price": 250,
      "job_code": "",
      "is_pump_job": true,
      "is_tank_job": true,
      "sort_order": 12,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "1d7043b8-1516-486b-a955-ff66d845dfa5",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "On Call Fee(pump truck)",
      "price": 150,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 13,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "fdbe8b78-c035-4346-a6f2-6c5e04ecc43c",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Difficult Waste Disposal",
      "price": 200,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 14,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "41c0139a-1248-4cd1-852d-3de8cf07c4ad",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Pump Truck Standby",
      "price": 315,
      "job_code": "Sb",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 15,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "c7b4eb1d-8e0f-4e78-8158-50e8e73fc74b",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Vinal Haven, North Haven, Islesboro Septic Pumping",
      "price": 640,
      "job_code": "Ip",
      "is_pump_job": true,
      "is_tank_job": true,
      "sort_order": 16,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "918edcbf-da00-4411-8187-5099bf6c7c5f",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Pump Wet Well",
      "price": 250,
      "job_code": "Ww",
      "is_pump_job": true,
      "is_tank_job": true,
      "sort_order": 17,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "b5e565f9-92df-4c3e-a5f8-17058470435a",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Brewery Waste Disposal",
      "price": 145,
      "job_code": "",
      "is_pump_job": true,
      "is_tank_job": false,
      "sort_order": 18,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "31ea9bcb-bc8e-4458-b554-e5fdfed1f6e5",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Flat Rate Island Price",
      "price": 3000,
      "job_code": "",
      "is_pump_job": true,
      "is_tank_job": false,
      "sort_order": 19,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "1fe1bbcf-a099-4df3-a851-3f7d65832dc6",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "North Haven Treatment Plant Pumping Flat Rate No Disposal",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 20,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "4e349679-2124-4ba4-b8ec-4c4d507acafb",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "North Haven Treatment Plant Pumping Flat Rate With Disposal",
      "price": 2825,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 21,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "c6d3e5f7-0f90-46df-aa3f-627f0dd44800",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Vinalhaven Treatment Plant Pumping",
      "price": 315,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 22,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "d5fe5c6c-c82a-445d-8e2d-5f52fefdcaa8",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Ferry Service Pumping",
      "price": 260,
      "job_code": "",
      "is_pump_job": true,
      "is_tank_job": false,
      "sort_order": 23,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "86e8e490-f08b-4b65-9ced-cb05a3046cfd",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Vinalhaven Inspection",
      "price": 1200,
      "job_code": "Vi",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 24,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "c1605382-0e83-4c02-ab8b-6074b0177c52",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Inspection (North Haven, Islesboro Inspection)",
      "price": 495,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 25,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "186e058f-769d-44a8-bd44-f8604d94ceaa",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Lobster/Fish Waste Pumping",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 26,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "a67f5802-d3b3-4392-8810-f5b82e73b1c3",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Lobster/Fish Waste Disposal",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 27,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "6d1d42ef-f06e-4ec0-b621-a9ccd06c87ab",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Island Transporter Island Jobs Flat Rate",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 28,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "9176d7d1-c5c2-4285-99bd-d7d22dd61cb2",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Vault Toilet Pumping",
      "price": 0,
      "job_code": "Vt",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 29,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "0ffaa7e5-3399-4ede-8b3e-9c92eb3ed8f4",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Vault Toilet Disposal",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 30,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "c77d9518-9397-4e36-8df7-e640389d5db2",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Island Standby Pumping (North Haven, Vinalhaven, Islesboro)",
      "price": 0,
      "job_code": "",
      "is_pump_job": true,
      "is_tank_job": true,
      "sort_order": 31,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "4c623221-882b-48e7-bcad-5ebd80045974",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Island Sewer Inspection",
      "price": 0,
      "job_code": "Is",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 32,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "7184425f-52f8-4ebd-9392-d49b6ee41e3d",
      "category_id": "617df698-01e6-4e18-aa80-8daa383c17c0",
      "name": "Contracted Pumping",
      "price": 0,
      "job_code": "Co",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 33,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "73aa25a0-b089-4d74-a801-d3cf987c7cda",
      "category_id": "c4708965-4338-4b81-8fce-c963b8046b16",
      "name": "Drain Clearing (islands)",
      "price": 550,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 1,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "c16ebc27-a9a1-404c-ade6-7a12213e9008",
      "category_id": "c4708965-4338-4b81-8fce-c963b8046b16",
      "name": "Drain Clearing",
      "price": 275,
      "job_code": "Dc",
      "is_pump_job": true,
      "is_tank_job": true,
      "sort_order": 2,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "c1042ad6-e0b6-43f1-9b2e-ebe7c5cf5c02",
      "category_id": "c4708965-4338-4b81-8fce-c963b8046b16",
      "name": "On Call Fee(box truck)",
      "price": 100,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 3,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "d9c516fd-ec06-4125-bf46-92d97c7f12f6",
      "category_id": "c4708965-4338-4b81-8fce-c963b8046b16",
      "name": "Additional Hour Drain Clearing",
      "price": 250,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 4,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "3a1ff7c9-c5f7-4f15-bcf4-6e15abd2aeaa",
      "category_id": "fe8b090a-bf1d-465c-8414-62346fb5dee5",
      "name": "Sewer Line Inspection",
      "price": 350,
      "job_code": "Eli",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 1,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "58ca9790-719e-4b6e-b83b-196fa103a188",
      "category_id": "fe8b090a-bf1d-465c-8414-62346fb5dee5",
      "name": "Septic System Inspection",
      "price": 340,
      "job_code": "I",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 2,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "e474f80d-06fd-47bc-b107-1e03f84bee6e",
      "category_id": "fe8b090a-bf1d-465c-8414-62346fb5dee5",
      "name": "Camera",
      "price": 250,
      "job_code": "C",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 3,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "3dd01d69-daf4-4957-aff2-a1bdd68a68bc",
      "category_id": "fe8b090a-bf1d-465c-8414-62346fb5dee5",
      "name": "Steamer",
      "price": 250,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 4,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "1c9b7325-0b61-43a2-876c-f76551358084",
      "category_id": "fe8b090a-bf1d-465c-8414-62346fb5dee5",
      "name": "Flex Shaft",
      "price": 250,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 5,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "69459ef9-3756-42ce-8441-e5a1658e6c81",
      "category_id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Digging",
      "price": 20,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 1,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "af21b376-125b-4115-bda0-f5d25385c46b",
      "category_id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Service Call",
      "price": 0,
      "job_code": "Sc",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 2,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "0f80e805-8799-4357-8f4b-1035162bd50a",
      "category_id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Filter Cleaning",
      "price": 0,
      "job_code": "Fc",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 3,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "9834b76c-e44e-40c2-abd9-b11e02c34466",
      "category_id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Radio Locate",
      "price": 0,
      "job_code": "Rl",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 4,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "2b1a7fbe-5669-41f7-9c8e-7a714256b835",
      "category_id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Jack Hammer",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 5,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "7d224115-8041-4350-a125-dfe071b175d2",
      "category_id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Rootx Application",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 6,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "54687a0b-1713-45fe-be33-4927c234f10e",
      "category_id": "ce5c3ac1-e282-4d68-ba88-676d75c87d40",
      "name": "Automatic Filter Cleaning",
      "price": 0,
      "job_code": "Af",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 7,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "6c9a5b85-ef0d-48ef-b755-61e71cded6fd",
      "category_id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "Town Contract",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 1,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "e706da3e-54a4-4e55-9ad8-089bff7d14b4",
      "category_id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "POTW",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 2,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "560d71f1-c274-4e96-ae9d-cebccd438ddf",
      "category_id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "Semi Annual Sales and Use Tax Due",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 3,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "61d020d5-b586-4a29-8813-b341b8a8d876",
      "category_id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "Quarterly DEP Disposal Report Due",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 4,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "cd2eeb3c-e837-453d-80b1-1a02555355dc",
      "category_id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "Annual Signatory Letter to Rockland Waste Water",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 5,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "afb14ed6-2395-4eb4-bdc4-eab249264b4e",
      "category_id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "ME Lab Reminder to Schedule Effluent Test",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 6,
      "created_at": "2026-03-15T23:30:54.785Z"
    },
    {
      "id": "a19c05b9-a7ad-4fac-9845-390db5639a5c",
      "category_id": "4f7b99a2-5277-44cb-908f-f5541f5e91aa",
      "name": "Mid-Coast Solid Waste Reminder",
      "price": 0,
      "job_code": "",
      "is_pump_job": false,
      "is_tank_job": false,
      "sort_order": 7,
      "created_at": "2026-03-15T23:30:54.785Z"
    }
  ],
  "waste_sites": [
    {
      "name": "Interstate Septic Systems",
      "address": "10 Gordon Dr",
      "city": "Rockland",
      "state": "ME",
      "zip": "04841",
      "contact_name": "",
      "contact_phone": "",
      "notes": "",
      "is_default": true,
      "id": "a712273d-aa6f-4111-8bbf-4160e265ef24",
      "created_at": "2026-03-14T21:22:43.520Z",
      "updated_at": "2026-03-14T22:22:29.632Z",
      "contact_email": "",
      "state_license": "s-2006, dg g3 3553",
      "waste_permit": "",
      "disposal_rate": 0,
      "hours_of_operation": "",
      "certification_text": "",
      "directions": ""
    }
  ],
  "geocode_cache": [],
  "reminders": [],
  "service_due_notices": []
};

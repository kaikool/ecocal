#!/usr/bin/env python3
"""
ForexFactory Economic Calendar to ICS Converter

This script crawls the ForexFactory economic calendar, filters events by currency
and impact level, and generates an RFC 5545 compliant ICS calendar file.
"""

import os
import re
import sys
import time
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
import pytz

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ForexFactoryCalendarScraper:
    """Scrapes ForexFactory economic calendar and converts to ICS format"""
    
    def __init__(self):
        self.base_url = "https://www.forexfactory.com"
        self.calendar_url = f"{self.base_url}/calendar"
        
        # Configuration from environment variables
        self.timezone = os.getenv('FF_IANA_TZ', 'Asia/Bangkok')
        self.impact_filter = os.getenv('FF_IMPACT_KEEP', 'LOW,MEDIUM,HIGH').split(',')
        self.currency_filter = os.getenv('FF_CURR_KEEP', 'USD').split(',')
        self.month_param = os.getenv('FF_MONTH_PARAM', 'this')
        self.calendar_title = os.getenv('FF_CAL_TITLE', 'Economic Calendar')
        self.event_duration_minutes = int(os.getenv('FF_EVENT_MIN', '30'))
        
        # Setup timezone
        self.local_tz = pytz.timezone(self.timezone)
        self.utc_tz = pytz.UTC
        
        # Request session with retry logic
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        
        logger.info(f"Initialized scraper with timezone: {self.timezone}")
        logger.info(f"Filtering currencies: {self.currency_filter}")
        logger.info(f"Filtering impacts: {self.impact_filter}")

    def fetch_calendar_page(self, max_retries: int = 3) -> str:
        """Fetch the ForexFactory calendar page with retry logic"""
        url = f"{self.calendar_url}?month={self.month_param}"
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Fetching calendar page (attempt {attempt + 1}/{max_retries}): {url}")
                response = self.session.get(url, timeout=30)
                response.raise_for_status()
                
                logger.info(f"Successfully fetched calendar page ({len(response.text)} characters)")
                return response.text
                
            except requests.RequestException as e:
                logger.warning(f"Attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                else:
                    raise Exception(f"Failed to fetch calendar page after {max_retries} attempts: {e}")
        
        # Should never reach here, but for type safety
        raise Exception("Unexpected error in fetch_calendar_page")

    def parse_impact_level(self, impact_cell) -> str:
        """Parse impact level from various possible formats"""
        if not impact_cell:
            return "LOW"
        
        # Convert to string to analyze the full HTML structure
        cell_html = str(impact_cell).lower()
        
        # Log the cell HTML for debugging
        logger.debug(f"Analyzing impact cell: {cell_html[:200]}")
        
        # ForexFactory specific patterns - check for exact class patterns
        if any(pattern in cell_html for pattern in [
            'calendar__impact--3', 'calendar__impact-3', 'impact-red', 'impact-high',
            'high-impact', 'impact--red', 'red-impact', 'ff-impact-red', 'icon--ff-impact-red'
        ]):
            logger.debug(f"Found HIGH impact pattern in: {cell_html[:100]}")
            return "HIGH"
        elif any(pattern in cell_html for pattern in [
            'calendar__impact--2', 'calendar__impact-2', 'impact-orange', 'impact-medium', 
            'medium-impact', 'impact--orange', 'orange-impact', 'ff-impact-orange', 'icon--ff-impact-orange', 'icon--ff-impact-ora'
        ]):
            logger.debug(f"Found MEDIUM impact pattern in: {cell_html[:100]}")
            return "MEDIUM"
        elif any(pattern in cell_html for pattern in [
            'calendar__impact--1', 'calendar__impact-1', 'impact-green', 'impact-low',
            'low-impact', 'impact--green', 'green-impact', 'ff-impact-green', 'icon--ff-impact-green',
            'icon--ff-impact-yellow', 'ff-impact-yellow', 'yellow', 'icon--ff-impact-yel'
        ]):
            logger.debug(f"Found LOW impact pattern in: {cell_html[:100]}")
            return "LOW"
        
        # Look for color-based indicators in styles
        if any(color in cell_html for color in ['#ff6c7c', '#ff7e00', '#ffb54c', 'red', '#dc3545']):
            return "HIGH"
        elif any(color in cell_html for color in ['#ffa500', '#ff8c00', 'orange', '#fd7e14']):
            return "MEDIUM"
        elif any(color in cell_html for color in ['#01b600', '#28a745', 'green', '#198754']):
            return "LOW"
        
        # Check for icon patterns (ForexFactory might use icon fonts)
        if any(icon in cell_html for icon in ['fa-circle', 'fas fa-circle', 'icon-circle']):
            # Look for specific icon colors or classes
            if any(indicator in cell_html for indicator in ['red', 'danger', 'high']):
                return "HIGH"
            elif any(indicator in cell_html for indicator in ['orange', 'warning', 'medium']):
                return "MEDIUM"
            elif any(indicator in cell_html for indicator in ['green', 'success', 'low']):
                return "LOW"
        
        # Check nested elements more thoroughly
        nested_elements = impact_cell.find_all(['span', 'i', 'div', 'td', 'svg', 'path'])
        for elem in nested_elements:
            elem_classes = ' '.join(elem.get('class') or []).lower()
            elem_style = elem.get('style', '').lower()
            elem_html = str(elem).lower()
            
            # Color in style attributes
            if any(color in elem_style for color in ['red', '#ff', '#dc']):
                return "HIGH"
            elif any(color in elem_style for color in ['orange', '#ff8', '#fd']):
                return "MEDIUM"
            elif any(color in elem_style for color in ['green', '#01b', '#28a', '#198']):
                return "LOW"
            
            # Class-based impact detection
            if any(cls in elem_classes for cls in ['high', 'red', 'danger', '3']):
                return "HIGH"
            elif any(cls in elem_classes for cls in ['medium', 'orange', 'warning', '2']):
                return "MEDIUM"
            elif any(cls in elem_classes for cls in ['low', 'green', 'success', '1']):
                return "LOW"
        
        # Check for multiple bulls/stars indicators that some sites use
        bull_count = cell_html.count('●') + cell_html.count('★') + cell_html.count('•')
        if bull_count >= 3:
            return "HIGH"
        elif bull_count == 2:
            return "MEDIUM"
        elif bull_count == 1:
            return "LOW"
        
        # Default fallback
        return "LOW"

    def parse_time(self, time_str: str, date_obj: datetime) -> datetime:
        """Parse time string and convert to datetime object"""
        time_str = time_str.strip()
        
        # Handle special cases
        if not time_str or time_str.lower() in ['all day', 'tentative', '', 'day']:
            # Use default time of 08:00 local
            return self.local_tz.localize(date_obj.replace(hour=8, minute=0, second=0))
        
        # Parse regular time formats
        time_patterns = [
            r'(\d{1,2}):(\d{2})\s*(am|pm)?',
            r'(\d{1,2})\s*(am|pm)',
        ]
        
        for pattern in time_patterns:
            match = re.search(pattern, time_str.lower())
            if match:
                hour = int(match.group(1))
                minute = int(match.group(2)) if len(match.groups()) >= 2 and match.group(2) else 0
                ampm = match.group(3) if len(match.groups()) >= 3 else None
                
                # Convert to 24-hour format
                if ampm:
                    if ampm == 'pm' and hour != 12:
                        hour += 12
                    elif ampm == 'am' and hour == 12:
                        hour = 0
                
                return self.local_tz.localize(date_obj.replace(hour=hour, minute=minute, second=0))
        
        # Fallback to default time
        logger.warning(f"Could not parse time '{time_str}', using default 08:00")
        return self.local_tz.localize(date_obj.replace(hour=8, minute=0, second=0))

    def parse_calendar_events(self, html_content: str) -> List[Dict]:
        """Parse calendar events from HTML content"""
        soup = BeautifulSoup(html_content, 'html.parser')
        events = []
        
        # Multiple selector strategies for robustness
        calendar_selectors = [
            'table.calendar__table',
            'table[class*="calendar"]',
            '.calendar-table',
            'table.ff-calendar',
            '.economic-calendar table'
        ]
        
        calendar_table = None
        for selector in calendar_selectors:
            calendar_table = soup.select_one(selector)
            if calendar_table:
                logger.info(f"Found calendar table using selector: {selector}")
                break
        
        if not calendar_table:
            # Fallback: look for any table with calendar-like content
            tables = soup.find_all('table')
            for table in tables:
                if any(keyword in str(table).lower() for keyword in ['calendar', 'event', 'time', 'currency']):
                    calendar_table = table
                    logger.info("Found calendar table using fallback method")
                    break
        
        if not calendar_table:
            raise Exception("Could not find calendar table on the page")
        
        current_date = None
        rows = calendar_table.find_all('tr')
        
        logger.info(f"Processing {len(rows)} table rows")
        
        for row_idx, row in enumerate(rows):
            try:
                cells = row.find_all('td')
                if not cells:
                    continue
                
                # Check if this row contains a date - look in multiple cells and check row classes
                row_classes = ' '.join(row.get('class') or []).lower()
                
                # Look for date indicators - ForexFactory uses specific patterns
                date_found = False
                
                # Check if this row has date-specific classes or spans a week
                if any(keyword in row_classes for keyword in ['calendar__row--date', 'date', 'week']):
                    # This might be a date row - check all cells for date content
                    for i, cell in enumerate(cells):
                        cell_text = cell.get_text(strip=True)
                        cell_classes = ' '.join(cell.get('class') or []).lower()
                        cell_html = str(cell).lower()
                        
                        logger.debug(f"Checking potential date cell {i}: text='{cell_text}', classes='{cell_classes}'")
                        
                        # Check for date indicators in classes
                        if any(keyword in cell_classes for keyword in ['date', 'day', 'calendar__date']):
                            try:
                                parsed_date = self.parse_date(cell_text)
                                if parsed_date:
                                    current_date = parsed_date
                                    logger.debug(f"✅ Found date: {current_date} from text: '{cell_text}' in cell {i}")
                                    date_found = True
                                    break
                            except Exception as e:
                                logger.debug(f"Failed to parse date '{cell_text}': {e}")
                
                # Also check first cell for date patterns even without specific classes
                if not date_found and cells:
                    first_cell = cells[0]
                    first_text = first_cell.get_text(strip=True)
                    if first_text and len(first_text) < 30:
                        logger.debug(f"Testing first cell for date: '{first_text}'")
                        try:
                            parsed_date = self.parse_date(first_text)
                            if parsed_date and parsed_date != datetime.now().replace(hour=0, minute=0, second=0, microsecond=0):
                                current_date = parsed_date
                                logger.debug(f"✅ Found date in first cell: {current_date} from text: '{first_text}'")
                                date_found = True
                        except Exception as e:
                            logger.debug(f"Failed to parse first cell date '{first_text}': {e}")
                
                # If this was a date row, continue to next row
                if date_found:
                    continue
                
                # Skip if we don't have a current date
                if not current_date:
                    # Try to set a default date if we haven't found any yet
                    if row_idx < 50:  # Only try this for early rows
                        current_date = datetime.now()
                        logger.debug(f"Using default date: {current_date}")
                    else:
                        continue
                
                # Process event row - look for rows with enough cells
                if len(cells) >= 3:
                    # Try to extract event data
                    event_data = self.extract_event_data_improved(cells, current_date, row_idx)
                    if event_data:
                        events.append(event_data)
                        logger.debug(f"Found event: {event_data['title']} ({event_data['currency']}) - Impact: {event_data['impact']}")
                    
            except Exception as e:
                logger.debug(f"Error processing row {row_idx}: {e}")
                continue
        
        logger.info(f"Successfully parsed {len(events)} events")
        return events

    def parse_date(self, date_str: str) -> Optional[datetime]:
        """Parse date string to datetime object"""
        if not date_str:
            return None
            
        date_str = date_str.strip()
        
        # Skip if too short or too long
        if len(date_str) < 1 or len(date_str) > 50:
            return None
        
        # Skip obvious non-dates
        if any(exclude in date_str.lower() for exclude in ['usd', 'eur', 'gbp', 'jpy', 'time', 'event', 'impact']):
            return None
        
        now = datetime.now()
        logger.debug(f"Parsing date string: '{date_str}'")
        
        # Month name mappings
        month_names = {
            'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
            'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6,
            'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'september': 9,
            'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12
        }
        
        # Day name mappings
        day_names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        
        date_lower = date_str.lower().strip()
        
        # Pattern 1: "Monday Aug 26", "Mon Aug 26", or "SatAug 30" (day + month + date)
        # First try with spaces
        day_month_date_match = re.search(r'(\w+)\s+(\w+)\s+(\d{1,2})', date_str, re.IGNORECASE)
        if day_month_date_match:
            day_name = day_month_date_match.group(1).lower()
            month_str = day_month_date_match.group(2).lower()
            day_num = int(day_month_date_match.group(3))
            
            if month_str in month_names and 1 <= day_num <= 31:
                month_num = month_names[month_str]
                try_date = datetime(now.year, month_num, day_num)
                if try_date < now - timedelta(days=60):  # If too far in past, try next year
                    try_date = datetime(now.year + 1, month_num, day_num)
                logger.debug(f"Parsed as day+month+date: {try_date}")
                return try_date
        
        # Pattern 1b: "SatAug 30" (no space between day and month)
        day_month_nospace_match = re.search(r'(\w{3})(\w{3})\s+(\d{1,2})', date_str, re.IGNORECASE)
        if day_month_nospace_match:
            day_name = day_month_nospace_match.group(1).lower()
            month_str = day_month_nospace_match.group(2).lower()
            day_num = int(day_month_nospace_match.group(3))
            
            if month_str in month_names and 1 <= day_num <= 31:
                month_num = month_names[month_str]
                try_date = datetime(now.year, month_num, day_num)
                if try_date < now - timedelta(days=60):
                    try_date = datetime(now.year + 1, month_num, day_num)
                logger.debug(f"Parsed as day+month+date (no space): {try_date}")
                return try_date
        
        # Pattern 2: "Aug 26" (month + date)
        month_date_match = re.search(r'^(\w+)\s+(\d{1,2})$', date_str, re.IGNORECASE)
        if month_date_match:
            month_str = month_date_match.group(1).lower()
            day_num = int(month_date_match.group(2))
            
            if month_str in month_names and 1 <= day_num <= 31:
                month_num = month_names[month_str]
                try_date = datetime(now.year, month_num, day_num)
                if try_date < now - timedelta(days=60):
                    try_date = datetime(now.year + 1, month_num, day_num)
                logger.debug(f"Parsed as month+date: {try_date}")
                return try_date
        
        # Pattern 3: "Monday 26" (day + date)
        day_date_match = re.search(r'^(\w+)\s+(\d{1,2})$', date_str, re.IGNORECASE)
        if day_date_match:
            day_name = day_date_match.group(1).lower()
            day_num = int(day_date_match.group(2))
            
            if day_name in day_names and 1 <= day_num <= 31:
                # Use current month first, then try next month if needed
                try:
                    try_date = datetime(now.year, now.month, day_num)
                    logger.debug(f"Parsed as day+date: {try_date}")
                    return try_date
                except ValueError:
                    # Try next month
                    next_month = now.month + 1 if now.month < 12 else 1
                    next_year = now.year if now.month < 12 else now.year + 1
                    try:
                        try_date = datetime(next_year, next_month, day_num)
                        logger.debug(f"Parsed as day+date (next month): {try_date}")
                        return try_date
                    except ValueError:
                        pass
        
        # Pattern 4: Just day number like "26"
        day_only_match = re.search(r'^(\d{1,2})$', date_str)
        if day_only_match:
            day_num = int(day_only_match.group(1))
            if 1 <= day_num <= 31:
                try:
                    try_date = datetime(now.year, now.month, day_num)
                    logger.debug(f"Parsed as day only: {try_date}")
                    return try_date
                except ValueError:
                    # Try next month
                    next_month = now.month + 1 if now.month < 12 else 1
                    next_year = now.year if now.month < 12 else now.year + 1
                    try:
                        try_date = datetime(next_year, next_month, day_num)
                        logger.debug(f"Parsed as day only (next month): {try_date}")
                        return try_date
                    except ValueError:
                        pass
        
        # Pattern 5: MM/DD or DD/MM format
        slash_match = re.search(r'(\d{1,2})/(\d{1,2})', date_str)
        if slash_match:
            num1, num2 = int(slash_match.group(1)), int(slash_match.group(2))
            # Try MM/DD first (US format)
            if 1 <= num1 <= 12 and 1 <= num2 <= 31:
                try:
                    try_date = datetime(now.year, num1, num2)
                    logger.debug(f"Parsed as MM/DD: {try_date}")
                    return try_date
                except ValueError:
                    pass
            # Try DD/MM
            if 1 <= num2 <= 12 and 1 <= num1 <= 31:
                try:
                    try_date = datetime(now.year, num2, num1)
                    logger.debug(f"Parsed as DD/MM: {try_date}")
                    return try_date
                except ValueError:
                    pass
        
        # Pattern 6: Full ISO date YYYY-MM-DD
        iso_match = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', date_str)
        if iso_match:
            year, month, day = int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3))
            if 1 <= month <= 12 and 1 <= day <= 31:
                try:
                    try_date = datetime(year, month, day)
                    logger.debug(f"Parsed as ISO date: {try_date}")
                    return try_date
                except ValueError:
                    pass
        
        logger.debug(f"Could not parse date: '{date_str}'")
        return None

    def extract_event_data_improved(self, cells: List, current_date: datetime, row_idx: int) -> Optional[Dict]:
        """Improved event data extraction from table cells"""
        if not current_date or len(cells) < 3:
            return None
        
        try:
            # Initialize variables
            time_str = ""
            currency = ""
            impact = "LOW"
            event_title = ""
            actual = ""
            forecast = ""
            previous = ""
            
            # Try to identify columns by content patterns and position
            for i, cell in enumerate(cells):
                cell_text = cell.get_text(strip=True)
                cell_classes = ' '.join(cell.get('class') or []).lower()
                cell_html = str(cell).lower()
                
                # Skip empty cells
                if not cell_text:
                    # Check if empty cell might have impact icons/visual indicators
                    test_impact = self.parse_impact_level(cell)
                    if test_impact != "LOW":
                        impact = test_impact
                        logger.debug(f"Found impact in empty cell {i}: {cell_html[:150]}, impact={impact}")
                    continue
                
                # Look for time patterns (HH:MM format or keywords)
                if re.match(r'\d{1,2}:\d{2}', cell_text) or cell_text.lower() in ['all day', 'tentative']:
                    time_str = cell_text
                
                # Look for currency codes (3 letter uppercase)
                elif re.match(r'^[A-Z]{3}$', cell_text):
                    currency = cell_text
                
                # Check ALL cells for impact indicators, especially positions 1-3 where impact usually is
                if i <= 4:  # Check first few columns for impact
                    test_impact = self.parse_impact_level(cell)
                    if test_impact != "LOW":
                        impact = test_impact
                        logger.debug(f"Found {test_impact} impact in cell {i}: {cell_html[:150]}")
                
                # Look for event titles (longer text, not pure numbers)
                if len(cell_text) > 5 and not re.match(r'^\d+(\.\d+)?[KMB%]*$', cell_text) and not re.match(r'^\d{1,2}:\d{2}', cell_text):
                    if not event_title or len(cell_text) > len(event_title):  # Take the longest meaningful text as event title
                        event_title = cell_text
                
                # Look for numeric values (actual, forecast, previous) - but be more specific
                if re.match(r'^-?\d+(\.\d+)?[KMB%]?$', cell_text):
                    if 'actual' in cell_classes:
                        actual = cell_text
                    elif 'forecast' in cell_classes:
                        forecast = cell_text
                    elif 'previous' in cell_classes:
                        previous = cell_text
                    elif not actual:
                        actual = cell_text
                    elif not forecast:
                        forecast = cell_text
                    elif not previous:
                        previous = cell_text
            
            # Validate required fields
            if not currency or currency not in self.currency_filter:
                return None
                
            if not event_title:
                return None
            
            # Parse time
            event_time = self.parse_time(time_str, current_date)
            
            # Filter by impact
            if impact not in self.impact_filter:
                return None
            
            return {
                'title': event_title,
                'currency': currency,
                'impact': impact,
                'start_time': event_time,
                'actual': actual,
                'forecast': forecast,
                'previous': previous
            }
            
        except Exception as e:
            logger.debug(f"Error extracting event data from row {row_idx}: {e}")
            return None

    def extract_event_data(self, cells: List, current_date: Optional[datetime]) -> Optional[Dict]:
        """Extract event data from table cells"""
        if not current_date or len(cells) < 4:
            return None
        
        try:
            # Common cell order patterns
            patterns = [
                # Pattern 1: time, currency, impact, event, actual, forecast, previous
                {'time': 0, 'currency': 1, 'impact': 2, 'event': 3, 'actual': 4, 'forecast': 5, 'previous': 6},
                # Pattern 2: currency, time, impact, event, actual, forecast, previous
                {'currency': 0, 'time': 1, 'impact': 2, 'event': 3, 'actual': 4, 'forecast': 5, 'previous': 6},
                # Pattern 3: time, event, currency, impact, actual, forecast, previous
                {'time': 0, 'event': 1, 'currency': 2, 'impact': 3, 'actual': 4, 'forecast': 5, 'previous': 6},
            ]
            
            event_data = None
            
            for pattern in patterns:
                try:
                    # Extract data according to pattern
                    time_cell = cells[pattern['time']] if pattern['time'] < len(cells) else None
                    currency_cell = cells[pattern['currency']] if pattern['currency'] < len(cells) else None
                    impact_cell = cells[pattern['impact']] if pattern['impact'] < len(cells) else None
                    event_cell = cells[pattern['event']] if pattern['event'] < len(cells) else None
                    
                    # Validate currency
                    currency = currency_cell.get_text(strip=True) if currency_cell else ""
                    if currency not in self.currency_filter:
                        return None
                    
                    # Parse time
                    time_str = time_cell.get_text(strip=True) if time_cell else ""
                    event_time = self.parse_time(time_str, current_date)
                    
                    # Parse impact
                    impact = self.parse_impact_level(impact_cell)
                    if impact not in self.impact_filter:
                        return None
                    
                    # Extract event title
                    event_title = event_cell.get_text(strip=True) if event_cell else "Economic Event"
                    
                    # Extract additional data
                    actual = cells[pattern.get('actual', -1)].get_text(strip=True) if pattern.get('actual', -1) < len(cells) else ""
                    forecast = cells[pattern.get('forecast', -1)].get_text(strip=True) if pattern.get('forecast', -1) < len(cells) else ""
                    previous = cells[pattern.get('previous', -1)].get_text(strip=True) if pattern.get('previous', -1) < len(cells) else ""
                    
                    event_data = {
                        'title': event_title,
                        'currency': currency,
                        'impact': impact,
                        'start_time': event_time,
                        'actual': actual,
                        'forecast': forecast,
                        'previous': previous
                    }
                    
                    # If we successfully extracted meaningful data, break
                    if event_title and currency:
                        break
                        
                except (IndexError, AttributeError):
                    continue
            
            return event_data
            
        except Exception as e:
            logger.debug(f"Error extracting event data: {e}")
            return None

    def generate_ics_content(self, events: List[Dict]) -> str:
        """Generate ICS calendar content from events"""
        
        # ICS header
        ics_lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//ForexFactory//Economic Calendar//EN",
            f"X-WR-CALNAME:{self.escape_ics_text(self.calendar_title)}",
            "X-WR-TIMEZONE:UTC",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH"
        ]
        
        for i, event in enumerate(events):
            try:
                # Convert to UTC
                start_utc = event['start_time'].astimezone(self.utc_tz)
                end_utc = start_utc + timedelta(minutes=self.event_duration_minutes)
                
                # Generate UID
                uid = f"ff-{start_utc.strftime('%Y%m%d%H%M%S')}-{i}@forexfactory.com"
                
                # Create event with impact indicator
                impact_indicator = self.get_impact_indicator(event['impact'])
                summary_text = f"{impact_indicator} {event['title']}"
                event_lines = [
                    "BEGIN:VEVENT",
                    f"UID:{uid}",
                    f"DTSTAMP:{datetime.now(self.utc_tz).strftime('%Y%m%dT%H%M%SZ')}",
                    f"DTSTART:{start_utc.strftime('%Y%m%dT%H%M%SZ')}",
                    f"DTEND:{end_utc.strftime('%Y%m%dT%H%M%SZ')}",
                    f"SUMMARY:{self.escape_ics_text(summary_text)}",
                ]
                
                # Create description
                description_parts = [
                    f"Currency: {event['currency']}",
                    f"Impact: {event['impact']}"
                ]
                
                if event['actual']:
                    description_parts.append(f"Actual: {event['actual']}")
                if event['forecast']:
                    description_parts.append(f"Forecast: {event['forecast']}")
                if event['previous']:
                    description_parts.append(f"Previous: {event['previous']}")
                
                description = "\\n".join(description_parts)
                event_lines.append(f"DESCRIPTION:{self.escape_ics_text(description)}")
                event_lines.append("END:VEVENT")
                
                ics_lines.extend(event_lines)
                
            except Exception as e:
                logger.warning(f"Error generating ICS for event: {e}")
                continue
        
        ics_lines.append("END:VCALENDAR")
        
        return "\n".join(ics_lines)

    def get_impact_indicator(self, impact: str) -> str:
        """Get circular dot indicator for impact level"""
        if impact == "HIGH":
            return "🔴"  # Red circle for high impact
        elif impact == "MEDIUM":
            return "🟡"  # Yellow circle for medium impact
        else:  # LOW
            return "🟢"  # Green circle for low impact

    def escape_ics_text(self, text: str) -> str:
        """Escape special characters for ICS format"""
        if not text:
            return ""
        
        # RFC 5545 escaping rules
        text = text.replace("\\", "\\\\")  # Backslash
        text = text.replace(";", "\\;")    # Semicolon
        text = text.replace(",", "\\,")    # Comma
        text = text.replace("\n", "\\n")   # Newline
        text = text.replace("\r", "")      # Remove carriage return
        
        return text

    def run(self) -> str:
        """Main execution method"""
        try:
            logger.info("Starting ForexFactory calendar scraping...")
            
            # Fetch calendar page
            html_content = self.fetch_calendar_page()
            
            # Parse events
            events = self.parse_calendar_events(html_content)
            
            if not events:
                logger.warning("No events found matching criteria")
                return self.generate_ics_content([])
            
            logger.info(f"Found {len(events)} events matching criteria")
            
            # Generate ICS content
            ics_content = self.generate_ics_content(events)
            
            logger.info("Successfully generated ICS calendar")
            return ics_content
            
        except Exception as e:
            logger.error(f"Error during scraping: {e}")
            raise

def main():
    """Main function"""
    try:
        scraper = ForexFactoryCalendarScraper()
        ics_content = scraper.run()
        
        # Ensure public directory exists
        os.makedirs('public', exist_ok=True)
        
        # Write ICS file
        ics_path = 'public/calendar.ics'
        with open(ics_path, 'w', encoding='utf-8') as f:
            f.write(ics_content)
        
        logger.info(f"Calendar saved to {ics_path}")
        
        # Print some stats
        event_count = ics_content.count('BEGIN:VEVENT')
        logger.info(f"Generated calendar with {event_count} events")
        
        return 0
        
    except Exception as e:
        logger.error(f"Failed to generate calendar: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())

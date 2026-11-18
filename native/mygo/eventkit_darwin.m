#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>
#include <stdlib.h>
#include <string.h>

// Read-only EventKit adapter. Only cyberme_eventkit_authorize may request OS permission.
static NSString *statusName(EKEntityType type) {
  switch ((NSInteger)[EKEventStore authorizationStatusForEntityType:type]) {
    case 0: return @"not_determined";
    case 1: return @"restricted";
    case 2: return @"denied";
    case 3: return @"full";
    case 4: return @"write_only";
    default: return @"unknown";
  }
}
static char *encode(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  if (!data) return strdup("{\"ok\":false,\"code\":\"apple_encode_failed\"}");
  char *out = malloc(data.length + 1);
  memcpy(out, data.bytes, data.length);
  out[data.length] = 0;
  return out;
}
static char *denied(EKEntityType type) {
  return encode(@{@"ok": @NO, @"code": @"apple_permission_denied", @"status": statusName(type)});
}
static id orNull(id value) { return value ?: [NSNull null]; }
static NSString *clip(NSString *value, NSUInteger max) {
  if (value.length <= max) return value ?: @"";
  return [value substringToIndex:[value rangeOfComposedCharacterSequenceAtIndex:max].location];
}
static NSString *instant(NSDate *date) {
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.timeZone = NSTimeZone.localTimeZone;
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
  return [formatter stringFromDate:date];
}
static NSString *day(NSDate *date, NSTimeZone *zone) {
  NSDateFormatter *formatter = [NSDateFormatter new];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
  formatter.timeZone = zone ?: NSTimeZone.localTimeZone;
  formatter.dateFormat = @"yyyy-MM-dd";
  return [formatter stringFromDate:date];
}

char *cyberme_eventkit_status(void) {
  @autoreleasepool {
    return encode(@{@"ok": @YES, @"calendar": statusName(EKEntityTypeEvent), @"reminders": statusName(EKEntityTypeReminder)});
  }
}

char *cyberme_eventkit_authorize(int reminders) {
  @autoreleasepool {
    EKEntityType type = reminders ? EKEntityTypeReminder : EKEntityTypeEvent;
    NSString *before = statusName(type);
    // A denied or restricted state cannot be prompted again; it changes only in System Settings.
    if (![before isEqualToString:@"not_determined"] && ![before isEqualToString:@"write_only"]) return encode(@{@"ok": @YES, @"status": before});
    EKEventStore *store = [EKEventStore new];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    void (^finish)(BOOL, NSError *) = ^(BOOL granted, NSError *error) { dispatch_semaphore_signal(done); };
#if defined(__MAC_14_0) && __MAC_OS_X_VERSION_MAX_ALLOWED >= __MAC_14_0
    if (@available(macOS 14.0, *)) {
      if (reminders) [store requestFullAccessToRemindersWithCompletion:finish];
      else [store requestFullAccessToEventsWithCompletion:finish];
    } else
#endif
    {
      [store requestAccessToEntityType:type completion:finish];
    }
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 180 * NSEC_PER_SEC)) != 0) return encode(@{@"ok": @NO, @"code": @"apple_authorize_timeout", @"status": statusName(type)});
    return encode(@{@"ok": @YES, @"status": statusName(type)});
  }
}

char *cyberme_eventkit_events(double start, double end, int limit) {
  @autoreleasepool {
    if (![statusName(EKEntityTypeEvent) isEqualToString:@"full"]) return denied(EKEntityTypeEvent);
    EKEventStore *store = [EKEventStore new];
    NSPredicate *predicate = [store predicateForEventsWithStartDate:[NSDate dateWithTimeIntervalSince1970:start] endDate:[NSDate dateWithTimeIntervalSince1970:end] calendars:nil];
    NSArray<EKEvent *> *events = [[store eventsMatchingPredicate:predicate] sortedArrayUsingSelector:@selector(compareStartDateWithEvent:)];
    NSMutableArray *items = [NSMutableArray array];
    for (EKEvent *event in events) {
      if ((int)items.count >= limit) break;
      NSMutableDictionary *row = [@{@"id": orNull(event.eventIdentifier), @"title": clip(event.title, 300), @"calendar": clip(event.calendar.title, 200), @"location": orNull(event.location ? clip(event.location, 300) : nil), @"allDay": @(event.isAllDay), @"timeZone": orNull(event.timeZone.name)} mutableCopy];
      if (event.isAllDay) {
        // All-day events are calendar dates with an exclusive end; an instant would shift them across zones.
        // Calendar arithmetic stays correct on 23- and 25-hour DST days, and a last-second end still rounds up.
        NSTimeZone *zone = event.timeZone ?: NSTimeZone.localTimeZone;
        NSCalendar *calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
        calendar.timeZone = zone;
        NSDate *first = [calendar startOfDayForDate:event.startDate];
        NSDate *next = [calendar dateByAddingUnit:NSCalendarUnitDay value:1 toDate:first options:0];
        NSDate *lastStart = [calendar startOfDayForDate:event.endDate];
        NSDate *endExclusive = [lastStart isEqualToDate:event.endDate] ? event.endDate : [calendar dateByAddingUnit:NSCalendarUnitDay value:1 toDate:lastStart options:0];
        row[@"startDate"] = day(first, zone);
        row[@"endDate"] = day(endExclusive, zone);
        row[@"multiDay"] = @([endExclusive compare:next] == NSOrderedDescending);
      } else {
        row[@"start"] = instant(event.startDate);
        row[@"end"] = instant(event.endDate);
        row[@"multiDay"] = @(![day(event.startDate, nil) isEqualToString:day(event.endDate, nil)]);
      }
      [items addObject:row];
    }
    return encode(@{@"ok": @YES, @"items": items, @"hasMore": @((int)events.count > limit)});
  }
}

static NSDate *dueInstant(EKReminder *reminder) {
  NSDateComponents *parts = reminder.dueDateComponents;
  if (!parts || parts.hour == NSDateComponentUndefined) return nil;
  NSCalendar *calendar = parts.calendar ?: [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
  if (parts.timeZone) calendar.timeZone = parts.timeZone;
  return [calendar dateFromComponents:parts];
}
// A missing due date stays null, and a date-only due date never gains a time.
static id dueValue(EKReminder *reminder) {
  NSDateComponents *parts = reminder.dueDateComponents;
  if (!parts || parts.year == NSDateComponentUndefined || parts.month == NSDateComponentUndefined || parts.day == NSDateComponentUndefined) return [NSNull null];
  NSDate *at = dueInstant(reminder);
  if (at) return @{@"allDay": @NO, @"at": instant(at), @"timeZone": orNull(parts.timeZone.name)};
  return @{@"allDay": @YES, @"date": [NSString stringWithFormat:@"%04ld-%02ld-%02ld", (long)parts.year, (long)parts.month, (long)parts.day]};
}
static NSString *dueSort(EKReminder *reminder) {
  id due = dueValue(reminder);
  if (due == [NSNull null]) return @"~";
  return due[@"at"] ?: due[@"date"];
}

char *cyberme_eventkit_reminders(const char *list, int limit) {
  @autoreleasepool {
    if (![statusName(EKEntityTypeReminder) isEqualToString:@"full"]) return denied(EKEntityTypeReminder);
    EKEventStore *store = [EKEventStore new];
    NSArray<EKCalendar *> *all = [store calendarsForEntityType:EKEntityTypeReminder];
    NSMutableArray *lists = [NSMutableArray array];
    for (EKCalendar *calendar in [all subarrayWithRange:NSMakeRange(0, MIN(all.count, 50))]) [lists addObject:@{@"id": calendar.calendarIdentifier, @"title": clip(calendar.title, 200)}];
    NSArray<EKCalendar *> *selected = nil;
    NSString *wanted = [NSString stringWithUTF8String:list] ?: @"";
    if (wanted.length) {
      selected = [all filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(EKCalendar *calendar, NSDictionary *bindings) { return [calendar.calendarIdentifier isEqualToString:wanted]; }]];
      if (!selected.count) selected = [all filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(EKCalendar *calendar, NSDictionary *bindings) { return [calendar.title isEqualToString:wanted]; }]];
      if (!selected.count) return encode(@{@"ok": @NO, @"code": @"apple_list_not_found", @"lists": lists});
      if (selected.count > 1) return encode(@{@"ok": @NO, @"code": @"apple_list_ambiguous", @"lists": lists});
    }
    NSPredicate *predicate = [store predicateForIncompleteRemindersWithDueDateStarting:nil ending:nil calendars:selected];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSArray<EKReminder *> *found = nil;
    id fetch = [store fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *reminders) {
      found = reminders;
      dispatch_semaphore_signal(done);
    }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
      [store cancelFetchRequest:fetch];
      return encode(@{@"ok": @NO, @"code": @"apple_read_timeout"});
    }
    NSArray<EKReminder *> *sorted = [found ?: @[] sortedArrayUsingComparator:^NSComparisonResult(EKReminder *a, EKReminder *b) { return [dueSort(a) compare:dueSort(b)]; }];
    NSMutableArray *items = [NSMutableArray array];
    for (EKReminder *reminder in sorted) {
      if ((int)items.count >= limit) break;
      [items addObject:@{@"id": reminder.calendarItemIdentifier, @"title": clip(reminder.title, 300), @"list": clip(reminder.calendar.title, 200), @"priority": @(reminder.priority), @"due": dueValue(reminder)}];
    }
    return encode(@{@"ok": @YES, @"items": items, @"hasMore": @((int)sorted.count > limit), @"lists": lists});
  }
}
